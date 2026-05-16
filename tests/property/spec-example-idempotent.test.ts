import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/shared/canonical-json.js';
import { compile } from '../../src/toolkit/authoring/compile.js';
import { decompile } from '../../src/toolkit/authoring/decompile.js';
import { KITCHEN_SINK_SPEC } from '../fixtures/kitchen-sink-spec.js';

import { canonicalizeSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);
const SEED_OPT =
  process.env['VITEST_SEED'] !== undefined ? { seed: Number(process.env['VITEST_SEED']) } : {};

describe('kitchen-sink spec idempotency', () => {
  it('compiles to byte-identical flows across runs', () => {
    fc.assert(
      fc.property(fc.constant(KITCHEN_SINK_SPEC), (spec) => {
        const a = compile(spec).flows;
        const b = compile(spec).flows;
        expect(canonicalJson(a)).toBe(canonicalJson(b));
      }),
      { numRuns: NUM_RUNS, ...SEED_OPT },
    );
  });

  it('decompiles to the canonical kitchen-sink spec', () => {
    fc.assert(
      fc.property(fc.constant(KITCHEN_SINK_SPEC), (spec) => {
        const compiled = compile(spec);
        const back = decompile(compiled.flows);
        expect(canonicalizeSpec(back)).toEqual(canonicalizeSpec(spec));
      }),
      { numRuns: NUM_RUNS, ...SEED_OPT },
    );
  });
});
