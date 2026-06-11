#!/usr/bin/env node
/**
 * EVAL-2 — the S5 gate (`npm run eval:s5`): see-judge-adjust loop within a
 * TOTAL-invocation budget, plus live-editor fidelity of the result.
 *
 * S5 re-spec (fix plan EVAL-2 [Amended: gates blocker]): the agent stages a
 * change, SEES the result (REND-8's stage-output `after_png` — no explicit
 * render call), adjusts, re-sees — in **≤6 total invocations (MCP +
 * Read/exec)** with `max_failed: 0` — and the renderer it judged with is
 * proven editor-true (±2px) on the deployed result. Two legs:
 *
 *   1. DRIVER LEG — runs the canonical committed steps file
 *      (`scripts/eval/steps/s5-steps.json`) through the EVAL-1 MCP eval
 *      driver against the local sterile stack: unbudgeted setup (seed a
 *      mis-placed node, deploy w/ 1 confirmation) → budgeted loop
 *      {max_total_invocations: 6, max_failed: 0}: move_node → exec-Read
 *      after_png → discard_staged_change → move_node adjust → exec-Read
 *      after_png → unbudgeted verify (deploy w/ 1 confirmation).
 *   2. FIDELITY LEG — opens the REAL Node-RED editor headless over CDP
 *      (scripts/eval/cdp.mjs — the shared zero-new-dependency browser
 *      stack), captures the deployed S5 result's per-node geometry +
 *      port-box centers, and compares against `renderGeometry` (frozen
 *      contract #1) with REND-7's single ±2px comparator
 *      (scripts/eval/fidelity.mjs — duplicate comparators are banned).
 *
 * Prerequisite (docs/EVALUATION.md): `npm run fidelity:editor` green — this
 * runner re-uses the same fixture-freshness guard and aborts if the live
 * editor version is not covered by a committed editor-metrics capture.
 *
 * Gate declaration rule (fix plan §1/§2): eval:s5 must pass TWICE
 * CONSECUTIVELY, plus one live unscripted session recorded in the run file.
 *
 * Sterile-stack only: talks to localhost, seeds the committed baseline
 * fixture, and restores the previously deployed flows afterwards (unless
 * --keep-flows). All server state (snapshots/staging/audit/renders) lives in
 * a per-run temp dir under a fresh ENVIRONMENT_NAME — nothing touches
 * ~/.flow-otter.
 *
 * Exit codes (mirrors scripts/eval/driver.mjs): 0 = budget AND fidelity
 * pass; 1 = gate fail (budget violation, expectation failure, or fidelity
 * mismatch); 2 = abort (stale fixtures, unreachable stack, driver abort).
 *
 * Usage:
 *   npm run eval:s5 [-- --url http://localhost:1880] [--chrome "<path>"]
 *       [--tolerance 2] [--json /tmp/s5.json] [--screenshot /tmp/s5.png]
 *       [--keep-flows]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderGeometry } from '../../src/toolkit/render/svg.js';

import { connect, launchChrome } from './cdp.mjs';
import { EXIT_ABORT, EXIT_GATE_FAIL, EXIT_OK } from './driver.mjs';
import {
  captureEditorGeometry,
  checkFixtureFreshness,
  compareGeometry,
  editorComparableEntries,
  FIDELITY_TOLERANCE_PX,
  formatFidelityReport,
} from './fidelity.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRIVER = join(REPO_ROOT, 'scripts', 'eval', 'driver.mjs');
const STEPS_FILE = join(REPO_ROOT, 'scripts', 'eval', 'steps', 's5-steps.json');
const METRICS_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'editor-metrics');
/** Committed baseline the steps file authors against (seeded, then restored). */
const BASELINE_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'inject-to-debug.flows.json');
/** The tab every author call in s5-steps.json targets. */
const S5_TAB_ID = '1111111111111111';
/** The budgeted section name inside s5-steps.json. */
const LOOP_SECTION = 'loop';

function parseArgs(argv) {
  const opts = {
    url: 'http://localhost:1880',
    chrome: undefined,
    tolerance: FIDELITY_TOLERANCE_PX,
    json: undefined,
    screenshot: undefined,
    keepFlows: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--chrome') opts.chrome = argv[++i];
    else if (a === '--tolerance') opts.tolerance = Number(argv[++i]);
    else if (a === '--json') opts.json = resolve(argv[++i]);
    else if (a === '--screenshot') opts.screenshot = resolve(argv[++i]);
    else if (a === '--keep-flows') opts.keepFlows = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(opts.url)) {
    throw new Error(`--url must be a local Node-RED instance, got: ${opts.url}`);
  }
  if (!Number.isFinite(opts.tolerance) || opts.tolerance < 0) {
    throw new Error('--tolerance must be a non-negative number');
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

/** Same server-side modal dismissal as scripts/editor-fidelity-check.mjs. */
async function dismissEditorModals(url, version) {
  await api(url, '/settings/user', { method: 'POST', body: { telemetryEnabled: false } });
  await api(url, '/settings/user', {
    method: 'POST',
    body: {
      editor: { view: { 'view-show-welcome-tours': false }, tours: { welcome: version } },
    },
  });
}

function loadMetricsFixtures() {
  let files;
  try {
    files = readdirSync(METRICS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(join(METRICS_DIR, f), 'utf8')));
}

/** Run the canonical steps file through the EVAL-1 driver. */
function runDriverLeg(opts, workdir) {
  const envName = `eval-s5-${Date.now()}`;
  const flowOtterCmd =
    process.env.FLOW_OTTER_CMD ??
    [
      process.execPath,
      join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(REPO_ROOT, 'bin', 'flow-otter.ts'),
    ].join(' ');
  const res = spawnSync(process.execPath, [DRIVER, STEPS_FILE], {
    encoding: 'utf8',
    cwd: workdir,
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
      // Fresh env name per run: no cross-run staging/snapshot contamination,
      // no persisted-target rehydration, nothing under ~/.flow-otter.
      ENVIRONMENT_NAME: envName,
      ACTOR_NAME: 'eval-s5',
      LOG_LEVEL: 'warn',
    },
  });
  // Re-emit the driver's JSONL so an eval:s5 run is fully inspectable.
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
  return { status: res.status ?? EXIT_ABORT, lines };
}

/** Capture the deployed S5 result from the live editor and compare. */
async function runFidelityLeg(opts, flows) {
  const expectedAll = renderGeometry(flows, S5_TAB_ID);
  if (expectedAll.length === 0) {
    throw new Error(`renderGeometry produced no entries for tab ${S5_TAB_ID}.`);
  }
  const chrome = await launchChrome({ chromePath: opts.chrome });
  let captured;
  try {
    const session = await connect({ port: chrome.port });
    await session.navigate(`${opts.url}/`);
    captured = await captureEditorGeometry(session, { tabId: S5_TAB_ID });
    if (opts.screenshot) {
      await session.screenshot({ path: opts.screenshot, fullPage: true });
      console.log(`Screenshot: ${opts.screenshot}`);
    }
    await session.close();
  } finally {
    await chrome.kill();
  }
  if (captured.activeWorkspace !== S5_TAB_ID) {
    throw new Error(
      `Editor active workspace is ${captured.activeWorkspace}, expected ${S5_TAB_ID}.`,
    );
  }
  // Shared basis (REND-7): per-node geometry + ports; editor-derived kinds
  // (group rects) excluded from BOTH sides.
  const expected = editorComparableEntries(expectedAll);
  const actual = editorComparableEntries(captured.entries);
  return compareGeometry(expected, actual, { tolerancePx: opts.tolerance });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const settings = await api(opts.url, '/settings');
  const version = settings.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Could not read Node-RED version from /settings');
  }
  console.log(`S5 gate: Node-RED ${version} at ${opts.url}; steps ${STEPS_FILE}`);

  // Fixture-freshness guard (S5 prerequisite plumbing): never judge fidelity
  // against an uncalibrated editor.
  const freshness = checkFixtureFreshness({
    liveVersion: version,
    fixtures: loadMetricsFixtures(),
  });
  if (!freshness.fresh) {
    console.error(`Fixture-freshness guard FAILED (${freshness.rule}): ${freshness.reason}`);
    process.exit(EXIT_ABORT);
  }
  console.log(`Fixture freshness: ${freshness.rule} — ${freshness.reason}`);

  await dismissEditorModals(opts.url, version);

  const priorFlows = await api(opts.url, '/flows');
  const baseline = JSON.parse(readFileSync(BASELINE_FIXTURE, 'utf8'));
  const workdir = mkdtempSync(join(tmpdir(), 'flow-otter-s5-'));

  let driver;
  let fidelity = null;
  try {
    // Seed the committed baseline so the canonical steps file always runs
    // against the same starting state regardless of what was deployed.
    await api(opts.url, '/flows', {
      method: 'POST',
      body: baseline,
      headers: { 'Node-RED-Deployment-Type': 'full' },
    });
    console.log(`Baseline seeded (${baseline.length} objects, tab ${S5_TAB_ID}).`);

    driver = runDriverLeg(opts, workdir);
    if (driver.status === EXIT_OK) {
      // The verify deploy just landed the adjusted flows — the editor now
      // shows exactly the state the agent judged from the after_png renders.
      const deployedFlows = await api(opts.url, '/flows');
      fidelity = await runFidelityLeg(opts, deployedFlows);
      console.log(formatFidelityReport(fidelity));
    }
  } finally {
    // NOTE: never process.exit() inside the try — it would skip this restore.
    rmSync(workdir, { recursive: true, force: true });
    if (!opts.keepFlows) {
      await api(opts.url, '/flows', {
        method: 'POST',
        body: priorFlows,
        headers: { 'Node-RED-Deployment-Type': 'full' },
      });
      console.log('Prior flows restored.');
    }
  }

  if (driver.status !== EXIT_OK) {
    console.error(`S5 gate: driver leg FAILED (exit ${driver.status}).`);
    process.exit(driver.status === EXIT_ABORT ? EXIT_ABORT : EXIT_GATE_FAIL);
  }

  const done = driver.lines.find((l) => l.step === 'done') ?? {};
  const loop = (done.sections ?? []).find((s) => s.name === LOOP_SECTION);
  const loopInvocations = loop?.counters?.total_invocations ?? null;
  const verdict = {
    scenario: 'S5',
    node_red_version: version,
    steps_file: STEPS_FILE,
    loop_total_invocations: loopInvocations,
    loop_counters: loop?.counters ?? null,
    totals: done.totals ?? null,
    budget_violations: done.budget_violations ?? null,
    expect_failures: done.expect_failures ?? null,
    fidelity,
    pass: fidelity !== null && fidelity.pass === true,
  };
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(verdict, null, 2) + '\n');
    console.log(`Result JSON: ${opts.json}`);
  }
  console.log(
    `S5 gate: ${verdict.pass ? 'PASS' : 'FAIL'} — loop used ${String(loopInvocations)}/6 total ` +
      `invocations (MCP + exec), fidelity ${fidelity.pass ? 'PASS' : 'FAIL'} ` +
      `(±${fidelity.tolerance_px}px, ${fidelity.entries_compared} entries).`,
  );
  process.exit(verdict.pass ? EXIT_OK : EXIT_GATE_FAIL);
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(EXIT_ABORT);
});
