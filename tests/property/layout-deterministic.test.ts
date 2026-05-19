import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/shared/canonical-json.js';
import { layoutFlowsWithDagre as layoutFlows } from '../../src/toolkit/layout/dagre.js';

import { arbitraryAuthoringSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);

describe('layoutFlows determinism', () => {
  it('produces byte-identical output for the same spec across runs', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const a = layoutFlows(spec);
        const b = layoutFlows(spec);
        expect(canonicalJson(a)).toBe(canonicalJson(b));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
