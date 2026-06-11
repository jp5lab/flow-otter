/**
 * EVAL-6 — pins on the S4 safety-drill canary steps files
 * (`scripts/eval/steps/s4-steps.json` + `s4-readonly-steps.json`), run by
 * `npm run eval:canary` after EVERY fix batch (fix plan §1 "Safety spine:
 * zero regressions").
 *
 * These are pinned CREDITS: the 2026-06-10 audit found the safety spine held
 * flawlessly, and s4 PASSES at HEAD. The drills cover every S4 criterion
 * (docs/EVALUATION.md scenario table):
 *   - OOB runtime mutation → staged deploy REFUSES on drift
 *   - `rollback_last_change` restores a byte-identical snapshot (shared
 *     comparator via scripts/eval/compare-runtime-hash.mjs)
 *   - elicitation decline aborts deploy (slot intact afterwards)
 *   - READ_ONLY_MODE blocks writes (separate server env → separate file)
 *   - dangerous tools absent without their env flag
 *
 * Anyone loosening these files loosens the canary gate — these pins make
 * that loud. Budgets are EXACT (committed numbers, not the author's head);
 * `max_failed` counts the deliberately-provoked refusals, honestly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  lintSteps,
  normalizeSteps,
  type NormalizedSection,
  type NormalizedSteps,
} from '../../../../scripts/eval/driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEPS_DIR = path.resolve(HERE, '../../../../scripts/eval/steps');

/** The committed baseline fixture's tab (tests/fixtures/inject-to-debug.flows.json). */
const TAB_ID = '1111111111111111';
/** The baseline inject node — drills move it; its id doubles as its key. */
const TICK_KEY = '2222222222222222';

function loadNormalized(file: string): NormalizedSteps {
  return normalizeSteps(JSON.parse(readFileSync(path.join(STEPS_DIR, file), 'utf8')));
}

function section(steps: NormalizedSteps, name: string): NormalizedSection {
  const s = steps.sections.find((x) => x.name === name);
  expect(s, `section '${name}' missing`).toBeDefined();
  return s!;
}

describe('S4 main canary steps file (EVAL-6 — drift / rollback / decline / dangerous drills)', () => {
  it('is structurally valid v2 and passes the anti-gaming lint', () => {
    const steps = loadNormalized('s4-steps.json');
    expect(steps.version).toBe(2);
    expect(lintSteps(steps)).toEqual([]);
  });

  it('keeps env {} — the canary runner owns the sandboxed environment', () => {
    expect(loadNormalized('s4-steps.json').env).toEqual({});
  });

  it('has exactly the five drill sections, in drill order', () => {
    expect(loadNormalized('s4-steps.json').sections.map((s) => s.name)).toEqual([
      'seed-snapshot',
      'drift-drill',
      'rollback-restore',
      'decline-drill',
      'dangerous-absent',
    ]);
  });

  it('NO call anywhere carries force or force_takeover, and every budget pins them to 0', () => {
    const steps = loadNormalized('s4-steps.json');
    for (const s of steps.sections) {
      expect(s.budget?.['max_force'], `${s.name} max_force`).toBe(0);
      expect(s.budget?.['max_force_takeover'], `${s.name} max_force_takeover`).toBe(0);
      for (const c of s.calls) {
        expect(c.args?.['force'], `${s.name}: force on ${String(c.tool)}`).toBeUndefined();
        expect(c.args?.['force_takeover']).toBeUndefined();
      }
    }
  });

  it('seed-snapshot: stage + consented deploy, pinned to exactly one confirmation and a real snapshot', () => {
    const s = section(loadNormalized('s4-steps.json'), 'seed-snapshot');
    expect(s.budget).toEqual({
      max_mcp_calls: 2,
      max_deploy_confirmations: 1,
      max_failed: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
    expect(s.calls.map((c) => c.tool)).toEqual(['add_comment', 'deploy_staged_change']);
    const deploy = s.calls[1]!;
    expect(deploy.elicitation).toBe('accept');
    expect(deploy.args).toEqual({ staged_hash: '$PREV.staged_hash' });
    // The rollback drill depends on this deploy's pre-deploy snapshot.
    expect(deploy.expect?.match).toBe('"snapshot_before": "');
  });

  it('drift-drill: stage → exactly one mutates:true OOB exec → deploy REFUSES with drift diagnostics', () => {
    const s = section(loadNormalized('s4-steps.json'), 'drift-drill');
    expect(s.budget).toEqual({
      max_mcp_calls: 2,
      max_exec_steps: 1,
      max_failed: 1, // the expected drift refusal — honest accounting
      max_deploy_confirmations: 1,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 1, // the drill's whole point: ONE out-of-band mutation
    });
    expect(s.calls.map((c) => c.tool ?? 'exec')).toEqual([
      'move_node',
      'exec',
      'deploy_staged_change',
    ]);
    const oob = s.calls[1]!;
    expect(oob.mutates).toBe(true);
    expect(oob.exec).toContain('/flows');
    expect(oob.expect?.match).toBe('oob-mutation-applied');
    const deploy = s.calls[2]!;
    // confirm:true = the scripted-client consent path (s5 pins the
    // elicitation-accept path) — consent given, drift protection must STILL
    // refuse, and the WSB-1 transport must carry the hash diagnostics.
    expect(deploy.args).toEqual({ staged_hash: '$PREV.staged_hash', confirm: true });
    expect(deploy.expect).toEqual({
      error: true,
      match: 'has drifted[\\s\\S]*"expected_hash"',
    });
  });

  it('rollback-restore: rollback → byte-compare via the SHARED comparator → discard the stale stage', () => {
    const s = section(loadNormalized('s4-steps.json'), 'rollback-restore');
    expect(s.budget).toEqual({
      max_mcp_calls: 2,
      max_exec_steps: 1,
      max_failed: 0,
      max_deploy_confirmations: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
    expect(s.calls.map((c) => c.tool ?? 'exec')).toEqual([
      'rollback_last_change',
      'exec',
      'discard_staged_change',
    ]);
    expect(s.calls[0]!.expect?.match).toBe('"restored_hash": "[0-9a-f]{64}"');
    // Byte-identical restore is asserted by re-hashing the LIVE runtime with
    // the shared comparator (compare.mjs via compare-runtime-hash.mjs) and
    // comparing against rollback's own restored_hash output.
    const compare = s.calls[1]!;
    expect(compare.exec).toBe('node scripts/eval/compare-runtime-hash.mjs $PREV.restored_hash');
    expect(compare.mutates).not.toBe(true);
    expect(compare.expect?.match).toBe('restore-byte-identical');
    expect(s.calls[2]!.expect?.match).toBe('"discarded": true');
  });

  it('decline-drill: elicitation DECLINE aborts the deploy and leaves the staging slot intact', () => {
    const s = section(loadNormalized('s4-steps.json'), 'decline-drill');
    expect(s.budget).toEqual({
      max_mcp_calls: 4,
      max_failed: 1, // the declined deploy
      max_elicitation_declines: 1,
      max_deploy_confirmations: 0, // a decline must NEVER count as consent
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
    expect(s.calls.map((c) => c.tool)).toEqual([
      'move_node',
      'deploy_staged_change',
      'get_staged_change',
      'discard_staged_change',
    ]);
    const deploy = s.calls[1]!;
    expect(deploy.elicitation).toBe('decline');
    expect(deploy.args).toEqual({ staged_hash: '$PREV.staged_hash' });
    expect(deploy.expect).toEqual({ error: true, match: 'Deploy decline' });
    // The slot survives the decline: get_staged_change still shows a hash.
    expect(s.calls[2]!.expect).toEqual({
      error: false,
      match: '"staged_hash": "[0-9a-f]{64}"',
    });
  });

  it('dangerous-absent: dangerous tier is unregistered without ENABLE_DANGEROUS_TOOLS', () => {
    const s = section(loadNormalized('s4-steps.json'), 'dangerous-absent');
    expect(s.budget).toEqual({
      max_mcp_calls: 1,
      max_failed: 1,
      max_deploy_confirmations: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.tool).toBe('delete_flow');
    expect(s.calls[0]!.expect).toEqual({ error: true, match: 'Unknown tool: delete_flow' });
  });

  it('both drill moves target the baseline Tick node with pairwise-distinct positions', () => {
    const steps = loadNormalized('s4-steps.json');
    const moves = steps.sections
      .flatMap((s) => s.calls)
      .filter((c) => c.tool === 'move_node')
      .map(
        (c) => c.args as { tab_id: string; node_key: string; position: { x: number; y: number } },
      );
    expect(moves).toHaveLength(2);
    const keys = new Set<string>();
    for (const m of moves) {
      expect(m.tab_id).toBe(TAB_ID);
      expect(m.node_key).toBe(TICK_KEY);
      keys.add(`${m.position.x},${m.position.y}`);
    }
    // Distinct from each other AND from the baseline (100,100) — neither
    // move can trip the WSB-3 no-op refusal.
    keys.add('100,100');
    expect(keys.size).toBe(3);
  });
});

describe('S4 read-only canary steps file (EVAL-6 — READ_ONLY_MODE leg)', () => {
  it('is structurally valid v2 and pins READ_ONLY_MODE=true in its own env (separate server boot)', () => {
    const steps = loadNormalized('s4-readonly-steps.json');
    expect(steps.version).toBe(2);
    expect(lintSteps(steps)).toEqual([]);
    // READ_ONLY_MODE is a server-boot setting; the leg carries it in steps
    // env (merged OVER the runner's sandbox env — dirs stay sandboxed).
    expect(steps.env).toEqual({ READ_ONLY_MODE: 'true' });
  });

  it('has exactly one section with the committed budget — zero consents, zero OOB, zero force', () => {
    const steps = loadNormalized('s4-readonly-steps.json');
    expect(steps.sections.map((s) => s.name)).toEqual(['read-only']);
    expect(steps.sections[0]!.budget).toEqual({
      max_mcp_calls: 5,
      max_failed: 3,
      max_deploy_confirmations: 0,
      max_elicitation_declines: 0,
      max_force: 0,
      max_force_takeover: 0,
      max_oob: 0,
    });
  });

  it('reads still work; author/deploy/dangerous tiers are all unregistered', () => {
    const s = section(loadNormalized('s4-readonly-steps.json'), 'read-only');
    expect(s.calls.map((c) => c.tool)).toEqual([
      'health_check',
      'list_flows',
      'add_node',
      'deploy_staged_change',
      'delete_flow',
    ]);
    expect(s.calls[0]!.expect).toEqual({ error: false, match: '"read_only_mode": true' });
    expect(s.calls[1]!.expect).toEqual({ error: false });
    for (const blocked of s.calls.slice(2)) {
      expect(blocked.expect?.error).toBe(true);
      expect(blocked.expect?.match).toBe(`Unknown tool: ${blocked.tool!}`);
    }
  });

  it('contains no exec steps at all — the read-only leg cannot mutate anything', () => {
    const s = section(loadNormalized('s4-readonly-steps.json'), 'read-only');
    expect(s.calls.every((c) => c.exec === undefined)).toBe(true);
  });
});
