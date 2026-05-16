import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compile } from '../../src/toolkit/authoring/compile.js';
import { decompile } from '../../src/toolkit/authoring/decompile.js';
import { canonicalJson } from '../../src/shared/canonical-json.js';

import { arbitraryAuthoringSpec, canonicalizeSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);
const SEED_OPT =
  process.env['VITEST_SEED'] !== undefined ? { seed: Number(process.env['VITEST_SEED']) } : {};

describe('compile-decompile round-trip', () => {
  it('decompile(compile(spec)) is structurally equivalent to spec', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const compiled = compile(spec);
        const back = decompile(compiled.flows);
        expect(canonicalizeSpec(back)).toEqual(canonicalizeSpec(spec));
      }),
      { numRuns: NUM_RUNS, ...SEED_OPT },
    );
  });

  it('compile(decompile(compile(spec))) yields byte-identical flows', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const first = compile(spec);
        const back = decompile(first.flows);
        const second = compile(back, { prior: first.flows });
        expect(canonicalJson(second.flows)).toBe(canonicalJson(first.flows));
        expect(second.hash).toBe(first.hash);
      }),
      { numRuns: Math.min(NUM_RUNS, 500), ...SEED_OPT },
    );
  });
});
