import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addNode } from '../../src/toolkit/authoring/operations/add-node.js';
import { compile } from '../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../src/toolkit/authoring/types.js';
import { lintFlows } from '../../src/toolkit/lint/flows-lint.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';

const label = fc
  .array(fc.constantFrom(...ALPHA.split('')), { minLength: 1, maxLength: 24 })
  .map((chars) => chars.join(''));

function seedSpec(firstLabel: string): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tab-main',
        label: 'Main',
        nodes: [{ key: 'src', type: 'inject', label: firstLabel, position: { x: 120, y: 100 } }],
        connections: [],
        groups: [],
        comments: [],
      },
    ],
  };
}

describe('add_node default placement properties', () => {
  it('places a 12-node source chain with zero bbox-overlap diagnostics', () => {
    fc.assert(
      fc.property(fc.array(label, { minLength: 12, maxLength: 12 }), (labels) => {
        let spec = seedSpec(labels[0]!);
        let sourceKey = 'src';
        for (let i = 1; i < labels.length; i++) {
          const nextLabel = labels[i]!;
          const result = addNode(spec, 'tab-main', 'function', {
            key: `node-${i}`,
            label: nextLabel,
            sourceNodeKey: sourceKey,
          });
          spec = result.spec;
          sourceKey = result.newNodeKey;
        }

        const report = lintFlows(compile(spec).flows);
        expect(report.diagnostics.filter((d) => d.rule === 'bbox-overlap')).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
