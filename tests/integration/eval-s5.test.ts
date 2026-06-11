/**
 * EVAL-2 — the canonical S5 steps file (scripts/eval/steps/s5-steps.json)
 * run end-to-end through the EVAL-1 driver against the live compose stack.
 *
 * This is the STANDING budget regression for the S5 gate (fix plan §1):
 * see-judge-adjust in ≤6 TOTAL invocations (MCP + Read/exec), zero failed
 * calls, exactly one confirmation each for the setup and verify deploys —
 * achievable only because REND-8 puts `after_png` on the stage output. The
 * driver leg needs no browser, so it runs unconditionally; the FULL gate
 * (`npm run eval:s5` — driver leg + REND-7-comparator fidelity leg over
 * CDP) additionally runs here when env-gated:
 *
 *   FLOWOTTER_LIVE_EDITOR=true KEEP_STACK=true \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/eval-s5.test.ts
 *
 * The runtime is seeded with the committed baseline fixture before and
 * restored to its prior flows after, so the rest of the suite is undisturbed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env['FLOWOTTER_LIVE_EDITOR'] === 'true';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DRIVER = path.join(ROOT, 'scripts', 'eval', 'driver.mjs');
const RUNNER = path.join(ROOT, 'scripts', 'eval', 'run-s5.mjs');
const STEPS_FILE = path.join(ROOT, 'scripts', 'eval', 'steps', 's5-steps.json');
const BASELINE_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'inject-to-debug.flows.json');
const NR_BASE = process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880';
const S5_TAB_ID = '1111111111111111';
const FLOW_OTTER_CMD = [
  process.execPath,
  path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  path.join(ROOT, 'bin', 'flow-otter.ts'),
].join(' ');

interface DriverLine {
  step: string;
  [key: string]: unknown;
}

interface Counters {
  mcp_calls: number;
  failed: number;
  exec_steps: number;
  total_invocations: number;
  deploy_confirmations: number;
  [key: string]: number;
}

let tmpRoot: string;
let priorFlows: unknown;

async function postFlows(flows: unknown): Promise<void> {
  const res = await fetch(`${NR_BASE}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: JSON.stringify(flows),
  });
  expect(res.ok, `POST /flows -> ${res.status}`).toBe(true);
}

async function getFlows(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${NR_BASE}/flows`, { headers: { Accept: 'application/json' } });
  expect(res.ok).toBe(true);
  return (await res.json()) as Array<Record<string, unknown>>;
}

describe('canonical S5 steps file through the eval driver (EVAL-2)', () => {
  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'nrmcp-eval2-'));
    priorFlows = await getFlows();
    await postFlows(JSON.parse(await readFile(BASELINE_FIXTURE, 'utf8')));
  });

  afterAll(async () => {
    await postFlows(priorFlows);
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('driver leg: ≤6 total invocations (achieved: 5), zero failed, 1+1 confirmations — exit 0', async () => {
    const res = spawnSync(process.execPath, [DRIVER, STEPS_FILE], {
      encoding: 'utf8',
      cwd: tmpRoot,
      timeout: 180_000,
      env: {
        ...process.env,
        FLOW_OTTER_CMD,
        NODE_RED_BASE_URL: NR_BASE,
        FLOW_SOURCE: 'admin-api',
        ENABLE_WRITE_TOOLS: 'true',
        ENABLE_DEPLOY_TOOLS: 'true',
        READ_ONLY_MODE: 'false',
        ALLOWED_DEPLOYMENT_MODES: 'nodes,flows,full',
        SNAPSHOT_DIR: path.join(tmpRoot, 'snapshots'),
        STAGING_DIR: path.join(tmpRoot, 'staging'),
        AUDIT_LOG_PATH: path.join(tmpRoot, 'audit.jsonl'),
        RENDER_DIR: path.join(tmpRoot, 'renders'),
        ENVIRONMENT_NAME: `integration-eval2-${Date.now()}`,
        ACTOR_NAME: 'integration-test',
        LOG_LEVEL: 'warn',
      },
    });

    const lines = (res.stdout ?? '')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as DriverLine);
    const done = lines.find((l) => l.step === 'done');
    expect(done, `no done line; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBeDefined();

    expect(res.status, res.stdout).toBe(0);
    expect(done!['ok']).toBe(true);
    expect(done!['budget_violations']).toEqual([]);
    expect(done!['expect_failures']).toEqual([]);

    // THE S5 number: the budgeted loop section's total-invocation account.
    const sections = done!['sections'] as Array<{ name: string; counters: Counters }>;
    const loop = sections.find((s) => s.name === 'loop')!;
    expect(loop.counters).toMatchObject({
      mcp_calls: 3,
      exec_steps: 2,
      total_invocations: 5, // ≤ 6 — the gate budget, with one invocation spare
      failed: 0,
      oob_mutations: 0,
    });

    // Safety post-conditions: one consented deploy per unbudgeted bookend,
    // zero force / force_takeover / OOB anywhere in the run.
    expect(done!['totals']).toMatchObject({
      deploy_confirmations: 2,
      elicitation_declines: 0,
      failed: 0,
      force_uses: 0,
      force_takeover_uses: 0,
      oob_mutations: 0,
    });

    // The adjusted node landed where the loop's final move put it.
    const flows = await getFlows();
    const banner = flows.find((n) => n['_authoringKey'] === 's5-status-banner');
    expect(banner).toBeDefined();
    expect(banner).toMatchObject({ type: 'debug', z: S5_TAB_ID, x: 280, y: 100 });
  });

  it.runIf(LIVE)(
    'full gate (npm run eval:s5): driver leg + live-editor fidelity leg — exit 0',
    async () => {
      const jsonPath = path.join(tmpRoot, 's5-verdict.json');
      const res = spawnSync(
        process.execPath,
        [
          path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          RUNNER,
          '--url',
          NR_BASE,
          '--json',
          jsonPath,
        ],
        { encoding: 'utf8', cwd: ROOT, timeout: 300_000, env: { ...process.env } },
      );
      expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);

      const verdict = JSON.parse(await readFile(jsonPath, 'utf8')) as {
        pass: boolean;
        loop_total_invocations: number;
        fidelity: { pass: boolean; tolerance_px: number };
      };
      expect(verdict.pass).toBe(true);
      expect(verdict.loop_total_invocations).toBeLessThanOrEqual(6);
      expect(verdict.fidelity.pass).toBe(true);
      expect(verdict.fidelity.tolerance_px).toBe(2);
    },
  );
});
