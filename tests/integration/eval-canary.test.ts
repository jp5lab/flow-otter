/**
 * EVAL-6 — `npm run eval:canary` end-to-end against the live compose stack.
 *
 * This is the STANDING safety-spine regression (fix plan §1 "Safety spine:
 * zero regressions" — `eval:canary` after every fix batch). The s4 legs are
 * pinned CREDITS: the 2026-06-10 audit found the spine held flawlessly, so
 * the canary must pass at every HEAD; any future failure blocks everything
 * else.
 *
 * Asserted here (the runner's own verdict JSON, not re-derived):
 *   - all four legs exit 0: s4-main (drift refusal → byte-identical
 *     rollback → elicitation decline → dangerous-absent), s4-readonly
 *     (READ_ONLY_MODE blocks writes), s1-run1/s1-run2 (README Tab-1 loop);
 *   - every post-condition passes, including S1 idempotency: two runs from
 *     identically seeded baselines deploy byte-identical flows
 *     (canonicalFlowsHash + wiring fingerprint);
 *   - the committed budget numbers are EXACT: the recorded counters land
 *     precisely on the steps files' limits (committed numbers of record).
 *
 * The runner seeds the committed baseline per leg and restores the prior
 * runtime flows afterwards, so the rest of the suite is undisturbed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RUNNER = path.join(ROOT, 'scripts', 'eval', 'run-canary.mjs');
const NR_BASE = process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880';

interface Counters {
  mcp_calls: number;
  failed: number;
  exec_steps: number;
  total_invocations: number;
  deploy_confirmations: number;
  elicitation_declines: number;
  force_uses: number;
  force_takeover_uses: number;
  oob_mutations: number;
}

interface Verdict {
  scenario: string;
  legs: Array<{
    leg: string;
    exit: number;
    ok: boolean;
    totals: Counters | null;
    budget_violations: unknown[] | null;
    expect_failures: unknown[] | null;
  }>;
  post_conditions: Array<{ name: string; pass: boolean }>;
  pass: boolean;
}

let tmpRoot: string;
let priorFlows: unknown;

async function getFlows(): Promise<unknown> {
  const res = await fetch(`${NR_BASE}/flows`, { headers: { Accept: 'application/json' } });
  expect(res.ok).toBe(true);
  return res.json();
}

async function postFlows(flows: unknown): Promise<void> {
  const res = await fetch(`${NR_BASE}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: JSON.stringify(flows),
  });
  expect(res.ok, `POST /flows -> ${res.status}`).toBe(true);
}

describe('the canary gate (EVAL-6 — npm run eval:canary)', () => {
  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'nrmcp-eval6-'));
    priorFlows = await getFlows();
  });

  afterAll(async () => {
    // Belt-and-braces: the runner restores prior flows itself; re-restore in
    // case it aborted mid-leg.
    await postFlows(priorFlows);
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('passes at HEAD: all four legs exit 0, every post-condition green, counters exactly on budget', async () => {
    const jsonPath = path.join(tmpRoot, 'canary-verdict.json');
    const res = spawnSync(process.execPath, [RUNNER, '--url', NR_BASE, '--json', jsonPath], {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 540_000,
      env: { ...process.env },
    });
    expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);

    const verdict = JSON.parse(await readFile(jsonPath, 'utf8')) as Verdict;
    expect(verdict.pass).toBe(true);
    expect(verdict.legs.map((l) => l.leg)).toEqual([
      's4-main',
      's4-readonly',
      's1-run1',
      's1-run2',
    ]);
    for (const leg of verdict.legs) {
      expect(leg.exit, `leg ${leg.leg}`).toBe(0);
      expect(leg.ok, `leg ${leg.leg}`).toBe(true);
      expect(leg.budget_violations).toEqual([]);
      expect(leg.expect_failures).toEqual([]);
    }
    for (const pc of verdict.post_conditions) {
      expect(pc.pass, `post-condition: ${pc.name}`).toBe(true);
    }
    expect(verdict.post_conditions.map((p) => p.name.split(':')[0])).toEqual([
      's4-main',
      's4-readonly',
      's1-run1',
      's1-run2',
      's1 idempotency',
      's1 idempotency',
    ]);

    // THE committed numbers (steps-file budgets are exact, not headroom):
    // s4-main — one consent each for the seed deploy and the (refused) drift
    // deploy; the three honest failures are the drift refusal, the decline,
    // and the absent dangerous tool; exactly ONE OOB mutation; zero force.
    const s4 = verdict.legs.find((l) => l.leg === 's4-main')!.totals!;
    expect(s4).toMatchObject({
      mcp_calls: 11,
      exec_steps: 2,
      failed: 3,
      deploy_confirmations: 2,
      elicitation_declines: 1,
      force_uses: 0,
      force_takeover_uses: 0,
      oob_mutations: 1,
    });

    // s4-readonly — three blocked tiers, zero consents, zero mutations.
    const s4ro = verdict.legs.find((l) => l.leg === 's4-readonly')!.totals!;
    expect(s4ro).toMatchObject({
      mcp_calls: 5,
      failed: 3,
      deploy_confirmations: 0,
      elicitation_declines: 0,
      force_uses: 0,
      oob_mutations: 0,
    });

    // s1 — the README Tab-1 loop's per-op staging cost at HEAD: 15 author
    // ops + 15 consented deploys + 1 validate, zero failed. Both runs land
    // on identical counters (scripted determinism).
    for (const name of ['s1-run1', 's1-run2']) {
      const s1 = verdict.legs.find((l) => l.leg === name)!.totals!;
      expect(s1, name).toMatchObject({
        mcp_calls: 31,
        failed: 0,
        deploy_confirmations: 15,
        elicitation_declines: 0,
        force_uses: 0,
        force_takeover_uses: 0,
        oob_mutations: 0,
      });
    }
  });
});
