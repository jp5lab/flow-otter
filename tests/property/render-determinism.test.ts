import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compile } from '../../src/toolkit/authoring/compile.js';
import { renderSvg } from '../../src/toolkit/render/svg.js';

import { arbitraryAuthoringSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);

describe('renderSvg determinism', () => {
  it('produces byte-identical SVG for the same flows across runs', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const flows = compile(spec).flows;
        expect(renderSvg(flows)).toBe(renderSvg(flows));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
