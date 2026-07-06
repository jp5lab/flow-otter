#!/usr/bin/env node
/**
 * EVAL-5 — audit replay regression suite.
 *
 * Runs committed replay steps files through the EVAL-1 MCP eval driver
 * against the local sterile Node-RED stack. Each scenario is seeded from the
 * committed audit fixture, uses a fresh ENVIRONMENT_NAME/temp state dir per
 * driver run, restores the prior runtime flows afterwards, and asserts the
 * replay-level safety post-conditions the steps files cannot see across
 * runs:
 *
 * - successful deploys == deploy confirmations;
 * - every successful deploy has a non-null pre-deploy snapshot;
 * - force and force_takeover use is zero;
 * - e2 preserves wiring-map byte identity vs the seeded baseline;
 * - each scenario is run twice from identical baselines and the two final
 *   flows documents match by canonicalFlowsHash.
 *
 * Exit codes mirror scripts/eval/driver.mjs:
 *   0 pass, 1 gate fail, 2 abort.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalFlowsHash, compareWiring } from '../compare.mjs';
import { EXIT_ABORT, EXIT_GATE_FAIL, EXIT_OK } from '../driver.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DRIVER = join(REPO_ROOT, 'scripts', 'eval', 'driver.mjs');
const REPLAY_DIR = join(REPO_ROOT, 'scripts', 'eval', 'replay');
const AUDIT_FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'audit-2026-06-10');

export const S5_DELEGATION = Object.freeze({
  command: 'npm run eval:s5',
  steps_file: join(REPO_ROOT, 'scripts', 'eval', 'steps', 's5-steps.json'),
  note: 'S5 is owned by EVAL-2; replay references this file and does not copy it.',
});

export const REPLAY_SCENARIOS = Object.freeze({
  'e2:1': {
    scenario: 'e2',
    phase: 1,
    label: 'e2 phase 1',
    stepsFile: join(REPLAY_DIR, 'e2-steps.json'),
    baselineFixture: join(AUDIT_FIXTURE_DIR, 'e2-flows.json'),
    tabId: 'e2spag001',
    wiringIdentity: true,
    expectFailDefault: false,
  },
  'e1:1': {
    scenario: 'e1',
    phase: 1,
    label: 'e1 phase 1',
    stepsFile: join(REPLAY_DIR, 'e1-phase1-steps.json'),
    baselineFixture: join(AUDIT_FIXTURE_DIR, 'e1-flows.json'),
    tabId: 'f6f2187d.f17ca8',
    wiringIdentity: false,
    expectFailDefault: false,
  },
  'e1:2': {
    scenario: 'e1',
    phase: 2,
    label: 'e1 phase 2',
    stepsFile: join(REPLAY_DIR, 'e1-phase2-steps.json'),
    baselineFixture: join(AUDIT_FIXTURE_DIR, 'e1-flows.json'),
    tabId: 'f6f2187d.f17ca8',
    wiringIdentity: false,
    expectFailDefault: true,
  },
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function flowsArray(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc !== null && typeof doc === 'object' && Array.isArray(doc.flows)) return doc.flows;
  throw new Error('expected a flows.json array or {flows:[...]} envelope');
}

export function parseArgs(argv) {
  const opts = {
    url: 'http://localhost:1880',
    scenario: 'all',
    phase: undefined,
    json: undefined,
    keepFlows: false,
    expectFail: false,
    noExpectFail: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.url = argv[++i];
    else if (a === '--scenario') opts.scenario = argv[++i];
    else if (a === '--phase') opts.phase = Number(argv[++i]);
    else if (a === '--json') opts.json = resolve(argv[++i]);
    else if (a === '--keep-flows') opts.keepFlows = true;
    else if (a === '--expect-fail') opts.expectFail = true;
    else if (a === '--no-expect-fail') opts.noExpectFail = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(opts.url)) {
    throw new Error(`--url must be a local Node-RED instance, got: ${opts.url}`);
  }
  if (!['all', 'e1', 'e2'].includes(opts.scenario)) {
    throw new Error(`--scenario must be one of all|e1|e2, got: ${opts.scenario}`);
  }
  if (opts.phase !== undefined && opts.phase !== 1 && opts.phase !== 2) {
    throw new Error(`--phase must be 1 or 2, got: ${String(opts.phase)}`);
  }
  if (opts.expectFail && opts.noExpectFail) {
    throw new Error('--expect-fail and --no-expect-fail are mutually exclusive');
  }
  return opts;
}

export function selectedScenarioKeys(opts) {
  const all = Object.keys(REPLAY_SCENARIOS);
  let keys = opts.scenario === 'all' ? all : all.filter((k) => k.startsWith(`${opts.scenario}:`));
  if (opts.phase !== undefined) keys = keys.filter((k) => k.endsWith(`:${opts.phase}`));
  if (keys.length === 0) {
    throw new Error(`no replay scenario matches --scenario ${opts.scenario} --phase ${opts.phase}`);
  }
  return keys;
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

export function parseDriverLines(stdout) {
  return (stdout ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { step: 'unparseable', raw: l };
      }
    });
}

function parseToolJson(line) {
  if (typeof line?.result !== 'string') return null;
  try {
    return JSON.parse(line.result);
  } catch {
    return null;
  }
}

export function safetyPostConditions(lines) {
  const done = lines.find((l) => l.step === 'done') ?? null;
  if (done === null) {
    return [
      {
        name: 'driver emitted a done line',
        pass: false,
        expected: 'done line',
        actual: 'missing',
      },
    ];
  }

  const totals = done.totals ?? {};
  const deployLines = lines.filter((l) => l.step === 'deploy_staged_change');
  const successfulDeploys = deployLines.filter((l) => l.isError === false);
  const confirmations = totals.deploy_confirmations ?? 0;
  const forceUses = totals.force_uses ?? 0;
  const forceTakeoverUses = totals.force_takeover_uses ?? 0;

  const snapshotFailures = successfulDeploys
    .map((line) => ({ line, parsed: parseToolJson(line) }))
    .filter(
      ({ parsed }) => parsed?.snapshot_before === null || parsed?.snapshot_before === undefined,
    );

  return [
    {
      name: 'successful deploys equal deploy confirmations',
      pass: successfulDeploys.length === confirmations,
      expected: confirmations,
      actual: successfulDeploys.length,
    },
    {
      name: 'each successful deploy has a non-null snapshot_before',
      pass: snapshotFailures.length === 0,
      expected: 0,
      actual: snapshotFailures.length,
    },
    {
      name: 'force_uses == 0',
      pass: forceUses === 0,
      expected: 0,
      actual: forceUses,
    },
    {
      name: 'force_takeover_uses == 0',
      pass: forceTakeoverUses === 0,
      expected: 0,
      actual: forceTakeoverUses,
    },
  ];
}

export function wiringIdentityPostCondition({
  enabled,
  key,
  attempt,
  driverStatus,
  baselineFlows,
  finalFlows,
}) {
  if (!enabled || driverStatus !== EXIT_OK) return null;
  const wiring = compareWiring(baselineFlows, finalFlows);
  return {
    name: `${key} run${attempt}: wiring-map byte-identical to seeded baseline`,
    pass: wiring.identical,
    expected: 'identical wiring',
    actual: wiring.identical ? 'identical wiring' : JSON.stringify(wiring.diffs).slice(0, 500),
  };
}

function runDriverLeg(opts, scenario, attempt, workdir) {
  mkdirSync(workdir, { recursive: true });
  const flowOtterCmd =
    process.env.FLOW_OTTER_CMD ??
    [
      process.execPath,
      join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(REPO_ROOT, 'bin', 'flow-otter.ts'),
    ].join(' ');
  const envName = `eval-replay-${scenario.scenario}-p${scenario.phase}-run${attempt}-${Date.now()}`;
  const res = spawnSync(process.execPath, [DRIVER, scenario.stepsFile], {
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
      ENVIRONMENT_NAME: envName,
      ACTOR_NAME: 'eval-replay',
      LOG_LEVEL: 'warn',
    },
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  const lines = parseDriverLines(res.stdout ?? '');
  const done = lines.find((l) => l.step === 'done') ?? null;
  return { status: res.status ?? EXIT_ABORT, lines, done };
}

async function runScenario(opts, key, tmpRoot) {
  const scenario = REPLAY_SCENARIOS[key];
  const expectFail = opts.noExpectFail
    ? false
    : opts.expectFail || scenario.expectFailDefault === true;
  const baselineDoc = readJson(scenario.baselineFixture);
  const baselineFlows = flowsArray(baselineDoc);
  const baselineHash = canonicalFlowsHash(baselineFlows);
  const attempts = [];
  const postConditions = [];
  let aborted = false;

  for (const attempt of [1, 2]) {
    await api(opts.url, '/flows', {
      method: 'POST',
      body: baselineFlows,
      headers: { 'Node-RED-Deployment-Type': 'full' },
    });
    const seeded = await api(opts.url, '/flows');
    const seededHash = canonicalFlowsHash(seeded);
    console.log(
      `[${key} run${attempt}] baseline seeded (${baselineFlows.length} objects, ${seededHash.slice(
        0,
        12,
      )}...)`,
    );

    const workdir = join(tmpRoot, `${scenario.scenario}-p${scenario.phase}-run${attempt}`);
    const driver = runDriverLeg(opts, scenario, attempt, workdir);
    const finalFlows = await api(opts.url, '/flows');
    const finalHash = canonicalFlowsHash(finalFlows);
    const safety = safetyPostConditions(driver.lines).map((p) => ({
      ...p,
      name: `${key} run${attempt}: ${p.name}`,
    }));
    postConditions.push(...safety);

    if (driver.status === EXIT_ABORT || driver.done === null) {
      aborted = true;
    }

    attempts.push({
      attempt,
      exit: driver.status,
      expected_fail: expectFail,
      done: driver.done,
      seeded_hash: seededHash,
      final_hash: finalHash,
      safety,
      final_flows: finalFlows,
    });

    if (expectFail) {
      postConditions.push({
        name: `${key} run${attempt}: expected-fail left runtime byte-identical to seeded baseline`,
        pass: finalHash === seededHash,
        expected: seededHash,
        actual: finalHash,
      });
    }

    const wiringPostCondition = wiringIdentityPostCondition({
      enabled: scenario.wiringIdentity,
      key,
      attempt,
      driverStatus: driver.status,
      baselineFlows,
      finalFlows,
    });
    if (wiringPostCondition !== null) postConditions.push(wiringPostCondition);
  }

  if (attempts.length === 2) {
    const [a, b] = attempts;
    postConditions.push({
      name: `${key}: scenario-level idempotence by canonicalFlowsHash`,
      pass: a.final_hash === b.final_hash,
      expected: a.final_hash,
      actual: b.final_hash,
    });
  }

  const statusPass = expectFail
    ? attempts.every((r) => r.exit === EXIT_GATE_FAIL)
    : attempts.every((r) => r.exit === EXIT_OK);
  if (expectFail) {
    postConditions.push({
      name: `${key}: expected-fail status observed on both seeded runs`,
      pass: statusPass,
      expected: `${EXIT_GATE_FAIL},${EXIT_GATE_FAIL}`,
      actual: attempts.map((r) => r.exit).join(','),
    });
  }

  const postPass = postConditions.every((p) => p.pass);
  const pass = !aborted && statusPass && postPass;
  const publicAttempts = attempts.map(({ final_flows: _finalFlows, ...rest }) => rest);
  return {
    key,
    scenario: scenario.scenario,
    phase: scenario.phase,
    label: scenario.label,
    steps_file: scenario.stepsFile,
    baseline_fixture: scenario.baselineFixture,
    baseline_hash: baselineHash,
    expect_fail: expectFail,
    attempts: publicAttempts,
    post_conditions: postConditions,
    pass,
    aborted,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const keys = selectedScenarioKeys(opts);
  const settings = await api(opts.url, '/settings').catch(() => null);
  const nodeRedVersion =
    settings !== null && typeof settings.version === 'string' ? settings.version : null;

  console.log(
    `Replay gate: stack ${opts.url}; scenarios ${keys.join(', ')}; Node-RED ${
      nodeRedVersion ?? 'unknown'
    }`,
  );
  console.log(`S5 delegation: ${S5_DELEGATION.command} (${S5_DELEGATION.steps_file})`);

  const priorFlows = await api(opts.url, '/flows');
  const tmpRoot = mkdtempSync(join(tmpdir(), 'flow-otter-replay-'));
  const scenarioResults = [];

  try {
    for (const key of keys) {
      scenarioResults.push(await runScenario(opts, key, tmpRoot));
      if (scenarioResults.at(-1)?.aborted) break;
    }
  } finally {
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

  const aborted = scenarioResults.some((r) => r.aborted);
  const pass =
    !aborted && scenarioResults.length === keys.length && scenarioResults.every((r) => r.pass);
  const verdict = {
    gate: 'eval:replay',
    node_red_version: nodeRedVersion,
    scenarios: scenarioResults,
    s5_delegation: S5_DELEGATION,
    pass,
  };
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(verdict, null, 2) + '\n');
    console.log(`Result JSON: ${opts.json}`);
  }
  for (const scenario of scenarioResults) {
    for (const p of scenario.post_conditions) {
      console.log(`post-condition ${p.pass ? 'PASS' : 'FAIL'}: ${p.name}`);
      if (!p.pass) console.log(`  expected ${p.expected}\n  actual   ${p.actual}`);
    }
    console.log(
      `scenario ${scenario.pass ? 'PASS' : 'FAIL'}: ${scenario.key}${
        scenario.expect_fail ? ' (expected-fail record mode)' : ''
      }`,
    );
  }
  console.log(`Replay gate: ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(aborted ? EXIT_ABORT : pass ? EXIT_OK : EXIT_GATE_FAIL);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err.stack ?? String(err));
    process.exit(EXIT_ABORT);
  });
}
