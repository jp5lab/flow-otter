import fc from 'fast-check';
import { describe, it } from 'vitest';

import { compile } from '../../src/toolkit/authoring/compile.js';
import { runValidators } from '../../src/toolkit/validate/index.js';
import { canonicalJson } from '../../src/shared/canonical-json.js';

import { arbitraryAuthoringSpec } from './arbitraries.js';

describe('runValidators purity', () => {
  it('produces byte-identical diagnostic JSON across two calls', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const flows = compile(spec).flows;
        const a = runValidators(flows);
        const b = runValidators(flows);
        return canonicalJson(a.diagnostics) === canonicalJson(b.diagnostics);
      }),
      { numRuns: 1000 },
    );
  });
});
