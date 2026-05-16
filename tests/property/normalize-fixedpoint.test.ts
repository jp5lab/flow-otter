import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compile } from '../../src/toolkit/authoring/compile.js';
import { canonicalJson } from '../../src/shared/canonical-json.js';
import { normalize } from '../../src/toolkit/diff/normalize.js';

import { arbitraryAuthoringSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);
const SEED_OPT =
  process.env['VITEST_SEED'] !== undefined ? { seed: Number(process.env['VITEST_SEED']) } : {};

describe('normalize fixed-point', () => {
  it('normalize(normalize(flows)) === normalize(flows)', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const { flows } = compile(spec);
        const once = normalize(flows);
        const twice = normalize(once);
        expect(canonicalJson(once)).toBe(canonicalJson(twice));
      }),
      { numRuns: Math.min(NUM_RUNS, 500), ...SEED_OPT },
    );
  });
});
