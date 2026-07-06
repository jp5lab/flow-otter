import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/shared/canonical-json.js';
import { compile } from '../../src/toolkit/authoring/compile.js';
import { layoutLint } from '../../src/toolkit/lint/layout-lint.js';

import { arbitraryAuthoringSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);

describe('layoutLint properties', () => {
  it('is deterministic for the same flows input', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const flows = compile(spec).flows;
        expect(canonicalJson(layoutLint(flows))).toBe(canonicalJson(layoutLint(flows)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps every rule score and the overall score within [0, 1]', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const report = layoutLint(compile(spec).flows);
        expect(report.overall).toBeGreaterThanOrEqual(0);
        expect(report.overall).toBeLessThanOrEqual(1);
        for (const r of report.rules) {
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never emits error-severity diagnostics for layout rules', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const report = layoutLint(compile(spec).flows);
        expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
