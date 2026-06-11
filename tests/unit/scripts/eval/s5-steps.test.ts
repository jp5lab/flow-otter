/**
 * EVAL-2 — pins on the canonical S5 steps file
 * (`scripts/eval/steps/s5-steps.json`), the FULLY-FIXED S5 gate input run by
 * `npm run eval:s5`.
 *
 * The budget block here IS the F1/e3 regression pin (fix plan §4): the
 * see-judge-adjust loop must fit in ≤6 TOTAL invocations (MCP + Read/exec)
 * with zero failed calls, achievable only because REND-8 puts `after_png`
 * on the stage output (an explicit-render loop with the mandatory discard
 * costs 7 — verified in the plan against the single-slot guard). Anyone
 * loosening this file loosens the audit gate — these pins make that loud.
 *
 * Structure pinned ([Amended: gates blocker] — re-authored to be
 * structurally passable):
 *   setup  (unbudgeted)  — seed mis-placed node, deploy w/ 1 confirmation
 *   loop   (BUDGETED)    — move_node → exec-Read after_png →
 *                          discard_staged_change → move_node adjust →
 *                          exec-Read after_png
 *   verify (unbudgeted)  — deploy w/ 1 confirmation
 *   (the fidelity leg lives in scripts/eval/run-s5.mjs, on REND-7's shared
 *   comparator — not in the steps file)
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
const STEPS_PATH = path.resolve(HERE, '../../../../scripts/eval/steps/s5-steps.json');

/** The committed baseline fixture's tab (tests/fixtures/inject-to-debug.flows.json). */
const S5_TAB_ID = '1111111111111111';

function loadNormalized(): NormalizedSteps {
  return normalizeSteps(JSON.parse(readFileSync(STEPS_PATH, 'utf8')));
}

function section(steps: NormalizedSteps, name: string): NormalizedSection {
  const s = steps.sections.find((x) => x.name === name);
  expect(s, `section '${name}' missing`).toBeDefined();
  return s!;
}

/** Steps that count toward total_invocations: tool calls + exec steps. */
function invocationCount(s: NormalizedSection): number {
  return s.calls.filter((c) => c.tool !== undefined || c.exec !== undefined).length;
}

describe('canonical S5 steps file (EVAL-2 — the F1/e3 budget pin)', () => {
  it('is structurally valid v2 and passes the anti-gaming lint', () => {
    const steps = loadNormalized();
    expect(steps.version).toBe(2);
    expect(lintSteps(steps)).toEqual([]);
  });

  it('has exactly the setup → loop → verify section structure', () => {
    const steps = loadNormalized();
    expect(steps.sections.map((s) => s.name)).toEqual(['setup', 'loop', 'verify']);
  });

  it('LOOP budget is EXACTLY {max_total_invocations: 6, max_failed: 0} — the S5 gate', () => {
    const loop = section(loadNormalized(), 'loop');
    expect(loop.budget).toEqual({ max_total_invocations: 6, max_failed: 0 });
  });

  it('loop fits its own budget statically: 5 invocations (3 MCP + 2 exec) ≤ 6', () => {
    const loop = section(loadNormalized(), 'loop');
    expect(invocationCount(loop)).toBe(5);
    expect(loop.calls.filter((c) => c.tool !== undefined)).toHaveLength(3);
    expect(loop.calls.filter((c) => c.exec !== undefined)).toHaveLength(2);
  });

  it('loop is the REND-8 see-judge-adjust shape: move → Read after_png → discard → move → Read', () => {
    const loop = section(loadNormalized(), 'loop');
    expect(loop.calls.map((c) => c.tool ?? (c.exec !== undefined ? 'exec' : 'sleep'))).toEqual([
      'move_node',
      'exec',
      'discard_staged_change',
      'move_node',
      'exec',
    ]);
    // Each Read consumes REND-8's stage-output render path via the driver's
    // exec interpolation, and asserts real PNG magic bytes — the image
    // channel cannot silently degrade to SVG-as-text (audit F1).
    for (const read of loop.calls.filter((c) => c.exec !== undefined)) {
      expect(read.exec).toContain('$PREV.render.tabs.0.after_png');
      // \s+ between bytes: macOS od double-spaces, GNU od single-spaces.
      expect(read.expect?.match).toBe('89\\s+50\\s+4e\\s+47');
    }
    // The move outputs must carry a non-null after_png (rasterizer present).
    for (const move of loop.calls.filter((c) => c.tool === 'move_node')) {
      expect(move.expect?.match).toBe('"after_png": "');
    }
  });

  it('loop is NOT flagged layout_computed — S5 is the agent hand-eye loop, positions are its point', () => {
    const loop = section(loadNormalized(), 'loop');
    expect(loop.layout_computed).toBe(false);
  });

  it('setup and verify are unbudgeted on invocations but pin safety: 1 confirmation, 0 force/oob', () => {
    const steps = loadNormalized();
    for (const name of ['setup', 'verify']) {
      const s = section(steps, name);
      expect(s.budget).toEqual({
        max_deploy_confirmations: 1,
        max_failed: 0,
        max_force: 0,
        max_force_takeover: 0,
        max_oob: 0,
      });
    }
  });

  it('setup seeds the defect then deploys with consent; verify deploys the adjustment with consent', () => {
    const steps = loadNormalized();
    const setup = section(steps, 'setup');
    expect(setup.calls.map((c) => c.tool)).toEqual(['add_node', 'deploy_staged_change']);
    const verify = section(steps, 'verify');
    expect(verify.calls.map((c) => c.tool)).toEqual(['deploy_staged_change']);
    for (const deploy of [setup.calls[1]!, verify.calls[0]!]) {
      expect(deploy.elicitation).toBe('accept');
      expect(deploy.args).toEqual({ staged_hash: '$PREV.staged_hash' });
      expect(deploy.expect).toEqual({ error: false, match: '"ok": true' });
    }
  });

  it('every author call targets the committed baseline tab', () => {
    const steps = loadNormalized();
    for (const s of steps.sections) {
      for (const c of s.calls) {
        if (c.tool === 'add_node' || c.tool === 'move_node') {
          expect(c.args?.['tab_id']).toBe(S5_TAB_ID);
        }
      }
    }
  });

  it('the three positions are pairwise distinct — neither move can trip the WSB-3 no-op refusal', () => {
    const steps = loadNormalized();
    const setupAdd = section(steps, 'setup').calls[0]!;
    const opts = setupAdd.args?.['opts'] as { position: { x: number; y: number } };
    const moves = section(steps, 'loop')
      .calls.filter((c) => c.tool === 'move_node')
      .map((c) => (c.args as { position: { x: number; y: number } }).position);
    const positions = [opts.position, ...moves];
    expect(positions).toHaveLength(3);
    const keys = positions.map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(3);
  });
});
