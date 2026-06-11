#!/usr/bin/env node
/**
 * EVAL-6 — the safety-spine canary (`npm run eval:canary`): S4 safety drills
 * + S1 author-loop idempotency, run after EVERY fix batch (fix plan §1 —
 * "Safety spine: zero regressions"). These are pinned CREDITS: the audit
 * found the spine held flawlessly, so this gate must pass at every HEAD;
 * any future failure blocks everything else.
 *
 * Legs (each through the EVAL-1 MCP eval driver against the local sterile
 * stack, each from a freshly seeded committed baseline fixture):
 *
 *   1. S4 MAIN (`scripts/eval/steps/s4-steps.json`) — stage → OOB Admin-API
 *      mutation (`mutates: true`) → deploy REFUSES on drift →
 *      `rollback_last_change` → byte-identical restore (shared comparator
 *      via scripts/eval/compare-runtime-hash.mjs) → elicitation-decline
 *      aborts deploy with the staging slot intact → dangerous tools absent
 *      without their env flag.
 *   2. S4 READ-ONLY (`scripts/eval/steps/s4-readonly-steps.json`) — the
 *      steps file pins `READ_ONLY_MODE=true` in its own `env`: write /
 *      deploy / dangerous tools are unregistered ("Unknown tool"), reads
 *      still work, `health_check` reports `read_only_mode: true`.
 *   3+4. S1 TWICE (`scripts/eval/steps/s1-steps.json`) — the README Tab-1
 *      author loop (every common author tool, budget-recorded in the
 *      committed steps file), run twice from identically seeded baselines;
 *      the two deployed results must be byte-identical
 *      (`canonicalFlowsHash`, EVAL-1's shared comparator) — the README
 *      idempotency claim, ids included.
 *
 * Post-conditions asserted HERE (the steps files can't see across legs):
 * - after each S4 leg the runtime is byte-identical to its seeded baseline
 *   (the drills must leave no trace);
 * - S1 run1 actually changed the flows vs the baseline;
 * - S1 run1 === S1 run2 by canonical hash AND wiring fingerprint.
 *
 * Gate declaration rule (docs/EVALUATION.md, AUDIT-RERUN.md): canary green
 * TWICE CONSECUTIVELY for any gate declaration; the committed steps-file
 * budgets are the numbers of record — not the author's head.
 *
 * Sterile-stack only; prior flows restored afterwards (unless
 * --keep-flows); all server state (snapshots/staging/audit/renders) lives
 * in a per-run temp dir under a fresh ENVIRONMENT_NAME per leg.
 *
 * Exit codes (mirrors scripts/eval/driver.mjs): 0 = all legs + all
 * post-conditions pass; 1 = gate fail; 2 = abort (unreachable stack,
 * driver abort).
 *
 * Usage:
 *   npm run eval:canary [-- --url http://localhost:1880] [--json /tmp/canary.json]
 *       [--keep-flows]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalFlowsHash, compareWiring } from './compare.mjs';
import { EXIT_ABORT, EXIT_GATE_FAIL, EXIT_OK } from './driver.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRIVER = join(REPO_ROOT, 'scripts', 'eval', 'driver.mjs');
const STEPS_DIR = join(REPO_ROOT, 'scripts', 'eval', 'steps');
/** Committed baseline every leg starts from (seeded, then restored). */
const BASELINE_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'inject-to-debug.flows.json');

const LEGS = [
  { name: 's4-main', steps: join(STEPS_DIR, 's4-steps.json') },
  { name: 's4-readonly', steps: join(STEPS_DIR, 's4-readonly-steps.json') },
  { name: 's1-run1', steps: join(STEPS_DIR, 's1-steps.json') },
  { name: 's1-run2', steps: join(STEPS_DIR, 's1-steps.json') },
];

function parseArgs(argv) {
  const opts = { url: 'http://localhost:1880', json: undefined, keepFlows: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--json') opts.json = resolve(argv[++i]);
    else if (a === '--keep-flows') opts.keepFlows = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(opts.url)) {
    throw new Error(`--url must be a local Node-RED instance, got: ${opts.url}`);
  }
  return opts;
}

async function api(url, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const text = await res.text();
  return text.length > 0 ? JSON.parse(text) : null;
}

/** Run one steps file through the EVAL-1 driver with a sandboxed env. */
function runDriverLeg(opts, legName, stepsFile, workdir) {
  const flowOtterCmd =
    process.env.FLOW_OTTER_CMD ??
    [
      process.execPath,
      join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(REPO_ROOT, 'bin', 'flow-otter.ts'),
    ].join(' ');
  // cwd is the REPO ROOT (not the workdir): the S4 rollback drill's exec
  // step runs `node scripts/eval/compare-runtime-hash.mjs ...` by relative
  // path — the documented standalone-driver convention.
  const res = spawnSync(process.execPath, [DRIVER, stepsFile], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 300_000,
    env: {
      ...process.env,
      FLOW_OTTER_CMD: flowOtterCmd,
      NODE_RED_BASE_URL: opts.url,
      FLOW_SOURCE: 'admin-api',
      ENABLE_WRITE_TOOLS: 'true',
      ENABLE_DEPLOY_TOOLS: 'true',
      READ_ONLY_MODE: 'false',
      ALLOWED_DEPLOYMENT_MODES: 'nodes,flows,full',
      SNAPSHOT_DIR: join(workdir, 'snapshots'),
      STAGING_DIR: join(workdir, 'staging'),
      AUDIT_LOG_PATH: join(workdir, 'audit.jsonl'),
      RENDER_DIR: join(workdir, 'renders'),
      // Fresh env name per leg: no cross-leg staging/snapshot contamination,
      // no persisted-target rehydration, nothing under ~/.flow-otter.
      ENVIRONMENT_NAME: `eval-canary-${legName}-${Date.now()}`,
      ACTOR_NAME: 'eval-canary',
      LOG_LEVEL: 'warn',
    },
  });
  // Re-emit the driver's JSONL so a canary run is fully inspectable.
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  const lines = (res.stdout ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { step: 'unparseable', raw: l };
      }
    });
  const done = lines.find((l) => l.step === 'done') ?? null;
  return { status: res.status ?? EXIT_ABORT, done };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`Canary gate: stack ${opts.url}; legs ${LEGS.map((l) => l.name).join(', ')}`);

  const baseline = JSON.parse(readFileSync(BASELINE_FIXTURE, 'utf8'));
  const priorFlows = await api(opts.url, '/flows');
  const tmpRoot = mkdtempSync(join(tmpdir(), 'flow-otter-canary-'));

  const legResults = [];
  const postConditions = [];
  const finals = {}; // legName -> flows after the leg
  let aborted = false;

  try {
    for (const leg of LEGS) {
      // Seed the committed baseline so every leg starts from the same state.
      await api(opts.url, '/flows', {
        method: 'POST',
        body: baseline,
        headers: { 'Node-RED-Deployment-Type': 'full' },
      });
      const seeded = await api(opts.url, '/flows');
      const seededHash = canonicalFlowsHash(seeded);
      console.log(
        `[${leg.name}] baseline seeded (${seeded.length} objects, ${seededHash.slice(0, 12)}…)`,
      );

      const workdir = join(tmpRoot, leg.name);
      const { status, done } = runDriverLeg(opts, leg.name, leg.steps, workdir);
      finals[leg.name] = await api(opts.url, '/flows');
      const finalHash = canonicalFlowsHash(finals[leg.name]);

      legResults.push({
        leg: leg.name,
        steps_file: leg.steps,
        exit: status,
        ok: done?.ok === true,
        totals: done?.totals ?? null,
        budget_violations: done?.budget_violations ?? null,
        expect_failures: done?.expect_failures ?? null,
      });
      if (status === EXIT_ABORT || done === null) {
        aborted = true;
        break;
      }

      // S4 post-condition: the drills leave no trace — runtime byte-identical
      // to the seeded baseline (drift-refusal deployed nothing, rollback
      // restored, decline aborted, read-only blocked everything).
      if (leg.name.startsWith('s4')) {
        postConditions.push({
          name: `${leg.name}: runtime byte-identical to seeded baseline after the drills`,
          pass: finalHash === seededHash,
          expected: seededHash,
          actual: finalHash,
        });
      }
      // S1 post-condition (per run): the loop actually changed the flows.
      if (leg.name.startsWith('s1')) {
        postConditions.push({
          name: `${leg.name}: author loop changed the flows vs the baseline`,
          pass: finalHash !== seededHash,
          expected: `!= ${seededHash}`,
          actual: finalHash,
        });
      }
    }

    // S1 idempotency: two runs from identical baselines are byte-identical —
    // the README claim (stable _authoringKey-derived ids included), via
    // EVAL-1's shared comparator.
    if (!aborted && finals['s1-run1'] !== undefined && finals['s1-run2'] !== undefined) {
      const h1 = canonicalFlowsHash(finals['s1-run1']);
      const h2 = canonicalFlowsHash(finals['s1-run2']);
      postConditions.push({
        name: 's1 idempotency: run1 and run2 deployed byte-identical flows (canonicalFlowsHash)',
        pass: h1 === h2,
        expected: h1,
        actual: h2,
      });
      const wiring = compareWiring(finals['s1-run1'], finals['s1-run2']);
      postConditions.push({
        name: 's1 idempotency: run1 and run2 wiring fingerprints identical',
        pass: wiring.identical,
        expected: 'identical wiring',
        actual: wiring.identical ? 'identical wiring' : JSON.stringify(wiring.diffs).slice(0, 400),
      });
    }
  } finally {
    // NOTE: never process.exit() inside the try — it would skip this restore.
    rmSync(tmpRoot, { recursive: true, force: true });
    if (!opts.keepFlows) {
      await api(opts.url, '/flows', {
        method: 'POST',
        body: priorFlows,
        headers: { 'Node-RED-Deployment-Type': 'full' },
      });
      console.log('Prior flows restored.');
    }
  }

  const legsPass = legResults.length === LEGS.length && legResults.every((r) => r.exit === EXIT_OK);
  const postPass = postConditions.every((p) => p.pass);
  const verdict = {
    scenario: 'canary (S4 safety drills + S1 idempotency)',
    legs: legResults,
    post_conditions: postConditions,
    pass: !aborted && legsPass && postPass,
  };
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(verdict, null, 2) + '\n');
    console.log(`Result JSON: ${opts.json}`);
  }
  for (const p of postConditions) {
    console.log(`post-condition ${p.pass ? 'PASS' : 'FAIL'}: ${p.name}`);
    if (!p.pass) console.log(`  expected ${p.expected}\n  actual   ${p.actual}`);
  }
  for (const r of legResults) {
    console.log(`leg ${r.exit === EXIT_OK ? 'PASS' : `FAIL (exit ${r.exit})`}: ${r.leg}`);
  }
  console.log(`Canary gate: ${verdict.pass ? 'PASS' : 'FAIL'}`);
  if (aborted) process.exit(EXIT_ABORT);
  process.exit(verdict.pass ? EXIT_OK : EXIT_GATE_FAIL);
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(EXIT_ABORT);
});
