/**
 * EVAL-1 — the promoted MCP eval driver (scripts/eval/driver.mjs) against
 * the live compose stack: passing run, budget-violation exit 1, expect
 * machinery, $PREV-poisoning hard abort (exit 2), anti-gaming position
 * lint (exit 2), FLOW_OTTER_CMD wiring, and elicitation accept/decline
 * with deploy-confirmation counting.
 *
 * The driver spawns the REAL server over stdio (via FLOW_OTTER_CMD → tsx),
 * exactly as eval campaigns do. Each run uses a unique ENVIRONMENT_NAME and
 * tmp snapshot/staging dirs so nothing leaks across runs or sessions.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareWiring } from '../../scripts/eval/compare.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DRIVER = path.join(ROOT, 'scripts', 'eval', 'driver.mjs');
const NR_BASE = process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880';
const FIXTURE_TAB_ID = '1111111111111111';
const FLOW_OTTER_CMD = [
  process.execPath,
  path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  path.join(ROOT, 'bin', 'flow-otter.ts'),
].join(' ');

interface DriverLine {
  step: string;
  [key: string]: unknown;
}

interface DriverRun {
  status: number;
  lines: DriverLine[];
  stdout: string;
  stderr: string;
}

let tmpRoot: string;
let runSeq = 0;

function stepsEnv(envName: string): Record<string, string> {
  return {
    NODE_RED_BASE_URL: NR_BASE,
    FLOW_SOURCE: 'admin-api',
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_DEPLOY_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
    ALLOWED_DEPLOYMENT_MODES: 'nodes,flows,full',
    SNAPSHOT_DIR: path.join(tmpRoot, envName, 'snapshots'),
    STAGING_DIR: path.join(tmpRoot, envName, 'staging'),
    AUDIT_LOG_PATH: path.join(tmpRoot, envName, 'audit.jsonl'),
    LOG_LEVEL: 'warn',
    // Unique env name per run so persisted-target rehydration is skipped.
    ENVIRONMENT_NAME: `integration-eval1-${envName}`,
    ACTOR_NAME: 'integration-test',
  };
}

async function runDriver(
  stepsFile: Record<string, unknown>,
  opts: { flowOtterCmd?: string } = {},
): Promise<DriverRun> {
  runSeq += 1;
  const stepsPath = path.join(tmpRoot, `steps-${runSeq}.json`);
  await writeFile(stepsPath, JSON.stringify(stepsFile, null, 2));
  const res = spawnSync(process.execPath, [DRIVER, stepsPath], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 120_000,
    env: { ...process.env, FLOW_OTTER_CMD: opts.flowOtterCmd ?? FLOW_OTTER_CMD },
  });
  const lines = (res.stdout ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as DriverLine);
  return { status: res.status ?? -1, lines, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function doneLine(run: DriverRun): DriverLine {
  const done = run.lines.find((l) => l.step === 'done');
  expect(
    done,
    `driver emitted no done line; stdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  ).toBeDefined();
  return done!;
}

async function fetchFlows(): Promise<unknown> {
  const res = await fetch(`${NR_BASE}/flows`, { headers: { Accept: 'application/json' } });
  expect(res.ok).toBe(true);
  return res.json();
}

describe('eval driver against the live compose stack (EVAL-1)', () => {
  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'nrmcp-eval1-'));
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('passing run: sections + budgets + expect + $PREV happy path + uncounted introspection — exit 0', async () => {
    const run = await runDriver({
      version: 2,
      env: stepsEnv('pass'),
      listTools: true,
      sections: [
        {
          name: 'setup',
          calls: [{ tool: 'get_flows_summary', expect: { error: false } }],
        },
        {
          name: 'loop',
          budget: { max_mcp_calls: 2, max_failed: 0, max_total_invocations: 3, max_oob: 0 },
          calls: [
            { tool: 'list_flows', expect: { error: false, match: '"tabs"' } },
            { tool: 'get_flow', args: { tab_id: '$PREV.tabs.0.id' }, expect: { error: false } },
            { exec: 'echo driver-exec-ok', expect: { match: 'driver-exec-ok' } },
          ],
        },
      ],
    });

    expect(run.status, run.stdout).toBe(0);
    const done = doneLine(run);
    expect(done['ok']).toBe(true);
    expect(done['budget_violations']).toEqual([]);
    expect(done['expect_failures']).toEqual([]);
    // listTools introspection ran but was NOT counted.
    expect(run.lines.some((l) => l.step === 'tools/list')).toBe(true);
    expect(done['totals']).toMatchObject({
      mcp_calls: 3,
      exec_steps: 1,
      total_invocations: 4,
      failed: 0,
      oob_mutations: 0,
    });
    const loopEnd = run.lines.find((l) => l.step === 'section-end' && l['section'] === 'loop')!;
    expect(loopEnd['counters']).toMatchObject({
      mcp_calls: 2,
      exec_steps: 1,
      total_invocations: 3,
    });
    expect(loopEnd['violations']).toEqual([]);
  });

  it('budget violation → exit 1 with the violated key, limit, and actual in the account', async () => {
    const run = await runDriver({
      version: 2,
      env: stepsEnv('violate'),
      sections: [
        {
          name: 'tight',
          budget: { max_mcp_calls: 1 },
          calls: [{ tool: 'list_flows' }, { tool: 'list_flows' }],
        },
      ],
    });

    expect(run.status, run.stdout).toBe(1);
    const done = doneLine(run);
    expect(done['ok']).toBe(false);
    expect(done['budget_violations']).toEqual([
      {
        section: 'tight',
        budget_key: 'max_mcp_calls',
        counter: 'mcp_calls',
        limit: 1,
        actual: 2,
      },
    ]);
  });

  it('expect machinery: unmet match → exit 1; expected error counts in failed but passes its budget', async () => {
    const matchFail = await runDriver({
      version: 2,
      env: stepsEnv('expectfail'),
      sections: [
        {
          name: 'main',
          calls: [{ tool: 'list_flows', expect: { match: 'THIS_WILL_NEVER_MATCH_8b1f' } }],
        },
      ],
    });
    expect(matchFail.status, matchFail.stdout).toBe(1);
    const failures = doneLine(matchFail)['expect_failures'] as Array<Record<string, unknown>>;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ section: 'main', tool: 'list_flows', check: 'match' });

    // An EXPECTED tool error satisfies expect.error:true yet still counts in
    // `failed` (honest accounting) — budget max_failed:1 absorbs it.
    const expectedError = await runDriver({
      version: 2,
      env: stepsEnv('expecterr'),
      sections: [
        {
          name: 'drill',
          budget: { max_failed: 1, max_mcp_calls: 1 },
          calls: [
            {
              tool: 'add_node',
              args: {
                tab_id: FIXTURE_TAB_ID,
                type: 'debug',
                opts: { key: 'eval1-offcanvas-probe', position: { x: 99980, y: 100 } },
              },
              expect: { error: true, match: 'validation error' },
            },
          ],
        },
      ],
    });
    expect(expectedError.status, expectedError.stdout).toBe(0);
    expect(doneLine(expectedError)['totals']).toMatchObject({ failed: 1, mcp_calls: 1 });
  });

  it('$PREV after a failed call → hard abort exit 2, later steps never run (79-call-cascade pin)', async () => {
    const run = await runDriver({
      version: 2,
      env: stepsEnv('poison'),
      sections: [
        {
          name: 'main',
          calls: [
            {
              // Deterministic stage-time failure (off-canvas lint error).
              tool: 'add_node',
              args: {
                tab_id: FIXTURE_TAB_ID,
                type: 'debug',
                opts: { key: 'eval1-poison-probe', position: { x: 99980, y: 100 } },
              },
            },
            { tool: 'get_staged_change', args: { probe: '$PREV.staged_hash' } },
            { tool: 'list_flows' },
          ],
        },
      ],
    });

    expect(run.status, run.stdout).toBe(2);
    const abortLine = run.lines.find((l) => l['aborted'] === true)!;
    expect(abortLine).toBeDefined();
    expect(String(abortLine['error'])).toMatch(/\$PREV poisoned/);
    expect(String(abortLine['error'])).toMatch(/'add_node' failed \(isError\)/);
    // The cascade is dead: the step after the poisoned reference never ran.
    expect(run.lines.some((l) => l.step === 'list_flows')).toBe(false);
    const done = doneLine(run);
    expect(done['ok']).toBe(false);
    expect(done['exit_code']).toBe(2);
  });

  it('anti-gaming lint: position fields in a layout_computed section → exit 2 before any server spawn', async () => {
    const run = await runDriver(
      {
        version: 2,
        env: stepsEnv('lint'),
        sections: [
          {
            name: 'layout',
            layout_computed: true,
            calls: [
              {
                tool: 'add_node',
                args: {
                  tab_id: FIXTURE_TAB_ID,
                  type: 'debug',
                  opts: { key: 'gamed', position: { x: 100, y: 100 } },
                },
              },
            ],
          },
        ],
      },
      // A non-existent server binary proves the lint fires pre-connect.
      { flowOtterCmd: '/nonexistent-flow-otter-binary --definitely-not-real' },
    );

    expect(run.status, run.stdout).toBe(2);
    const lintLine = run.lines.find((l) => l.step === 'lint')!;
    expect(lintLine).toBeDefined();
    expect(lintLine['aborted']).toBe(true);
    const violations = lintLine['violations'] as Array<Record<string, unknown>>;
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ section: 'layout', tool: 'add_node' });
    expect(violations[0]!['paths']).toContain('$.opts.position');
    expect(run.lines.some((l) => l.step === 'connect')).toBe(false);
  });

  it('FLOW_OTTER_CMD is honored: a bogus server command aborts at connect with exit 2', async () => {
    const run = await runDriver(
      {
        version: 2,
        env: stepsEnv('badcmd'),
        sections: [{ name: 'main', calls: [{ tool: 'list_flows' }] }],
      },
      { flowOtterCmd: '/nonexistent-flow-otter-binary --definitely-not-real' },
    );
    expect(run.status, run.stdout).toBe(2);
    const connectLine = run.lines.find((l) => l.step === 'connect')!;
    expect(connectLine).toBeDefined();
    expect(connectLine['aborted']).toBe(true);
    expect(connectLine['command']).toBe('/nonexistent-flow-otter-binary');
  });

  it('elicitation decline aborts the deploy, counts elicitation_declines, and mutates nothing', async () => {
    const flowsBefore = await fetchFlows();
    const run = await runDriver({
      version: 2,
      env: stepsEnv('decline'),
      sections: [
        {
          name: 'stage',
          calls: [
            {
              tool: 'add_node',
              args: { tab_id: FIXTURE_TAB_ID, type: 'debug', opts: { key: 'eval1-decline-probe' } },
              expect: { error: false },
            },
          ],
        },
        {
          name: 'deploy-declined',
          budget: { max_deploy_confirmations: 0, max_elicitation_declines: 1, max_failed: 1 },
          calls: [
            {
              tool: 'deploy_staged_change',
              args: { staged_hash: '$PREV.staged_hash' },
              elicitation: 'decline',
              expect: { error: true, match: 'decline' },
            },
          ],
        },
        {
          name: 'cleanup',
          calls: [{ tool: 'discard_staged_change', args: {}, expect: { error: false } }],
        },
      ],
    });

    expect(run.status, run.stdout).toBe(0);
    const done = doneLine(run);
    expect(done['totals']).toMatchObject({ elicitation_declines: 1, deploy_confirmations: 0 });
    const elicitLine = run.lines.find((l) => l.step === 'elicitation')!;
    expect(elicitLine).toMatchObject({ directive: 'decline', action: 'decline' });
    // Declined deploy never touched the runtime.
    const flowsAfter = await fetchFlows();
    expect(compareWiring(flowsBefore, flowsAfter).identical).toBe(true);
  });

  it('elicitation accept deploys (counted as deploy confirmations); add→remove restores wiring byte-identically', async () => {
    const flowsBefore = await fetchFlows();
    const run = await runDriver({
      version: 2,
      env: stepsEnv('accept'),
      sections: [
        {
          name: 'stage-add',
          calls: [
            {
              tool: 'add_node',
              args: { tab_id: FIXTURE_TAB_ID, type: 'debug', opts: { key: 'eval1-deploy-probe' } },
              expect: { error: false },
            },
          ],
        },
        {
          name: 'deploy-add',
          budget: {
            max_deploy_confirmations: 1,
            max_failed: 0,
            max_force: 0,
            max_force_takeover: 0,
          },
          calls: [
            {
              tool: 'deploy_staged_change',
              args: { staged_hash: '$PREV.staged_hash' },
              elicitation: 'accept',
              expect: { error: false, match: '"ok": true' },
            },
          ],
        },
        {
          name: 'stage-remove',
          calls: [
            {
              tool: 'remove_node',
              args: { tab_id: FIXTURE_TAB_ID, node_key: 'eval1-deploy-probe' },
              expect: { error: false },
            },
          ],
        },
        {
          name: 'deploy-remove',
          budget: { max_deploy_confirmations: 1, max_failed: 0 },
          calls: [
            {
              tool: 'deploy_staged_change',
              args: { staged_hash: '$PREV.staged_hash' },
              elicitation: 'accept',
              expect: { error: false, match: '"ok": true' },
            },
          ],
        },
      ],
    });

    expect(run.status, run.stdout).toBe(0);
    const done = doneLine(run);
    expect(done['ok']).toBe(true);
    expect(done['totals']).toMatchObject({
      deploy_confirmations: 2,
      elicitation_declines: 0,
      failed: 0,
      force_uses: 0,
      oob_mutations: 0,
    });
    // EVAL-5-style safety post-condition, via the shared comparator:
    // a deploy round-trip (add → remove) leaves the wiring map byte-identical.
    const flowsAfter = await fetchFlows();
    const wiring = compareWiring(flowsBefore, flowsAfter);
    expect(wiring.diffs).toEqual([]);
    expect(wiring.identical).toBe(true);
  });
});
