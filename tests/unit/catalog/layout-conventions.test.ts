/**
 * D-5 (R6/F4): the eight audit layout criteria are taught in-band through the
 * catalog's `layout_conventions` category, each naming the scored layout-lint
 * rule that machine-checks it.
 *
 * The `lint_rule` ids are FROZEN by the fix plan
 * (docs/plans/2026-06-10-fix-plan.md §3, items D-1/D-2) but the rules
 * themselves register with the v1.5.0 layout lint. The bidirectional
 * completeness suite below therefore ACTIVATES when
 * `src/toolkit/lint/layout-lint.ts` lands (D-1) — until then it is skipped
 * with the dormancy recorded by an always-on guard test. Convention required
 * of D-1/D-2: every registered layout rule id appears as a quoted
 * `'layout-*'` string literal in non-comment source under `src/toolkit/lint/`
 * (matching the existing `RULE_*` constant style in flows-lint.ts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildCatalog, selectCatalog } from '../../../src/toolkit/catalog/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LINT_DIR = path.resolve(__dirname, '../../../src/toolkit/lint');
const LAYOUT_LINT_FILE = path.join(LINT_DIR, 'layout-lint.ts');
const layoutLintLanded = existsSync(LAYOUT_LINT_FILE);

/**
 * The eight audit criteria and their frozen rule ids, in audit order.
 * Changing either column is a contract change — fix-plan D-1/D-2 freeze the
 * rule ids; the criteria are 1:1 with the 2026-06-10 audit question.
 */
const FROZEN_CRITERIA: readonly { criterion: string; lint_rule: string }[] = [
  { criterion: 'lifecycle_left_to_right', lint_rule: 'layout-stage-order' },
  { criterion: 'stages_visually_grouped', lint_rule: 'layout-group-overlap' },
  { criterion: 'stage_headers', lint_rule: 'layout-header-presence' },
  { criterion: 'error_lane_below', lint_rule: 'layout-error-lane-below' },
  { criterion: 'affirmative_output_on_top', lint_rule: 'layout-affirmative-on-top' },
  { criterion: 'minimal_wire_crossings', lint_rule: 'layout-wire-crossings' },
  { criterion: 'no_backward_wires', lint_rule: 'layout-backward-wires' },
  { criterion: 'grid_aligned_within_viewport', lint_rule: 'layout-viewport-overflow' },
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Quoted layout-* rule-id literals in non-comment lint source. */
function registeredLayoutRuleIds(): string[] {
  const ids = new Set<string>();
  for (const f of readdirSync(LINT_DIR)) {
    if (!f.endsWith('.ts')) continue;
    const src = stripComments(readFileSync(path.join(LINT_DIR, f), 'utf8'));
    for (const m of src.matchAll(/["'`](layout-[a-z][a-z-]*)["'`]/g)) {
      // 'layout-lint' is the module name, not a rule id.
      if (m[1] !== 'layout-lint') ids.add(m[1]!);
    }
  }
  return [...ids].sort();
}

describe('catalog layout_conventions (D-5)', () => {
  const entries = buildCatalog('test').layout_conventions;

  it('has exactly EIGHT entries, 1:1 with the audit criteria, naming the frozen rule ids', () => {
    expect(entries.map((e) => ({ criterion: e.criterion, lint_rule: e.lint_rule }))).toEqual(
      FROZEN_CRITERIA,
    );
  });

  it('every lint_rule is a unique id in the layout-* scored-rule namespace', () => {
    const rules = entries.map((e) => e.lint_rule);
    expect(new Set(rules).size).toBe(rules.length);
    for (const r of rules) expect(r).toMatch(/^layout-[a-z][a-z-]*$/);
  });

  it('every entry states its convention non-emptily with a snake_case criterion id', () => {
    for (const e of entries) {
      expect(e.criterion).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(e.convention.length).toBeGreaterThan(20);
    }
  });

  it.each(['20px', '140-220', '120', '1420', 'port 0', 'BELOW', 'left-to-right'])(
    'teaches the numeric convention token %s',
    (token) => {
      const joined = entries.map((e) => `${e.convention} ${e.notes ?? ''}`).join('\n');
      expect(joined).toContain(token);
    },
  );

  it('is served by selectCatalog as its own category', () => {
    const subset = selectCatalog('test', ['layout_conventions']);
    expect(subset.layout_conventions).toHaveLength(8);
    expect(subset.validators).toBeUndefined();
  });
});

describe('catalog ↔ registered layout lint rules (bidirectional; activates with D-1/D-2)', () => {
  it.runIf(!layoutLintLanded)(
    'is dormant: src/toolkit/lint/layout-lint.ts has not landed yet (fix-plan Phase 2)',
    () => {
      // When D-1 lands the layout lint module, this guard goes silent and the
      // two pins below activate automatically. Do not delete this test —
      // it is the recorded reason the bidirectional check may be skipped.
      expect(layoutLintLanded).toBe(false);
    },
  );

  it.skipIf(!layoutLintLanded)(
    'every catalog lint_rule is registered in src/toolkit/lint (no dangling references)',
    () => {
      const registered = new Set(registeredLayoutRuleIds());
      const dangling = FROZEN_CRITERIA.map((c) => c.lint_rule).filter((r) => !registered.has(r));
      expect(dangling, `catalog references unregistered rules: ${dangling.join(', ')}`).toEqual([]);
    },
  );

  it.skipIf(!layoutLintLanded)(
    'every registered layout-* rule id has a catalog layout_conventions entry (nothing untaught)',
    () => {
      const taught = new Set(buildCatalog('test').layout_conventions.map((e) => e.lint_rule));
      const untaught = registeredLayoutRuleIds().filter((r) => !taught.has(r));
      expect(
        untaught,
        `registered layout rules missing from catalog: ${untaught.join(', ')}`,
      ).toEqual([]);
    },
  );
});
