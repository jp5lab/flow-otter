import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/shared/canonical-json.js';
import { layoutFlowsWithDagre } from '../../src/toolkit/layout/dagre.js';
import { layoutFlowsWithElk } from '../../src/toolkit/layout/elk.js';

import { arbitraryAuthoringSpec, arbitraryJunctionBearingAuthoringSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);
const ELK_NUM_RUNS = Number(process.env['VITEST_PROP_RUNS_ELK'] ?? Math.min(NUM_RUNS, 100));

describe('layoutFlows determinism', () => {
  it('produces byte-identical output for the same spec across runs', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const a = layoutFlowsWithDagre(spec);
        const b = layoutFlowsWithDagre(spec);
        expect(canonicalJson(a)).toBe(canonicalJson(b));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic for junction-bearing specs across both engines', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryJunctionBearingAuthoringSpec, async (spec) => {
        const dagreA = layoutFlowsWithDagre(spec);
        const dagreB = layoutFlowsWithDagre(spec);
        expect(canonicalJson(dagreA)).toBe(canonicalJson(dagreB));

        const elkA = await layoutFlowsWithElk(spec);
        const elkB = await layoutFlowsWithElk(spec);
        expect(canonicalJson(elkA)).toBe(canonicalJson(elkB));
      }),
      { numRuns: ELK_NUM_RUNS },
    );
  });
});
