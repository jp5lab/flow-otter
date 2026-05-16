import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compile } from '../../src/toolkit/authoring/compile.js';
import { setLinks } from '../../src/toolkit/authoring/operations/set-links.js';
import { setWires } from '../../src/toolkit/authoring/operations/set-wires.js';
import { canonicalJson } from '../../src/shared/canonical-json.js';
import type { AuthoringSpec, TabSpec } from '../../src/toolkit/authoring/types.js';

import { arbitraryAuthoringSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);

interface LinkPairingScenario {
  spec: AuthoringSpec;
  sourceKey: string;
  targetKeys: string[];
}

const arbitraryLinkPairing: fc.Arbitrary<LinkPairingScenario> = fc
  .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 4 }))
  .map(([nLinkIns, sourceKind]) => {
    const tabA: TabSpec = {
      id: 'tab-A',
      label: 'A',
      nodes: [
        {
          key: 'src',
          type: sourceKind % 2 === 0 ? 'link out' : 'link call',
          label: 'Src',
          position: { x: 100, y: 100 },
        },
      ],
      connections: [],
      groups: [],
      comments: [],
    };
    const tabB: TabSpec = {
      id: 'tab-B',
      label: 'B',
      nodes: Array.from({ length: nLinkIns }, (_, i) => ({
        key: `in-${i}`,
        type: 'link in',
        label: `In ${i}`,
        position: { x: 100 + i * 60, y: 100 },
      })),
      connections: [],
      groups: [],
      comments: [],
    };
    return {
      spec: { tabs: [tabA, tabB] },
      sourceKey: 'src',
      targetKeys: tabB.nodes.map((n) => n.key),
    };
  });

describe('compile idempotency', () => {
  it('same spec produces byte-identical output across runs', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const a = compile(spec);
        const b = compile(spec);
        expect(canonicalJson(a.flows)).toBe(canonicalJson(b.flows));
        expect(a.hash).toBe(b.hash);
      }),
      {
        numRuns: NUM_RUNS,
        ...(process.env['VITEST_SEED'] !== undefined
          ? { seed: Number(process.env['VITEST_SEED']) }
          : {}),
      },
    );
  });

  it('compile + recompile via prior preserves IDs', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const first = compile(spec);
        const second = compile(spec, { prior: first.flows });
        // IDs preserved
        const firstIds = first.flows.map((n) => n.id).sort();
        const secondIds = second.flows.map((n) => n.id).sort();
        expect(secondIds).toEqual(firstIds);
      }),
      { numRuns: Math.min(NUM_RUNS, 200) },
    );
  });
});

describe('setWires idempotency', () => {
  const arbitrarySetWiresScenario = fc.integer({ min: 1, max: 5 }).map((nTargets) => {
    const tab: TabSpec = {
      id: 'tab-W',
      label: 'W',
      nodes: [
        { key: 'src', type: 'function', label: 'F', position: { x: 100, y: 100 } },
        ...Array.from({ length: nTargets }, (_, i) => ({
          key: `dst-${i}`,
          type: 'debug',
          label: `D${i}`,
          position: { x: 200 + i * 30, y: 100 },
        })),
      ],
      connections: [],
      groups: [],
      comments: [],
    };
    const spec: AuthoringSpec = { tabs: [tab] };
    return {
      spec,
      targetKeys: tab.nodes.slice(1).map((n) => n.key),
    };
  });

  it('re-running setWires with the same targets produces byte-identical compiled output', () => {
    fc.assert(
      fc.property(arbitrarySetWiresScenario, ({ spec, targetKeys }) => {
        const a = setWires(spec, {
          tabId: 'tab-W',
          sourceKey: 'src',
          outputPort: 0,
          targetKeys,
        });
        const b = setWires(a.spec, {
          tabId: 'tab-W',
          sourceKey: 'src',
          outputPort: 0,
          targetKeys,
        });
        const compiledA = compile(a.spec);
        const compiledB = compile(b.spec, { prior: compiledA.flows });
        expect(canonicalJson(compiledA.flows)).toBe(canonicalJson(compiledB.flows));
      }),
      { numRuns: Math.min(NUM_RUNS, 200) },
    );
  });
});

describe('setLinks idempotency', () => {
  it('re-running with the same pairing produces byte-identical compiled output', () => {
    fc.assert(
      fc.property(arbitraryLinkPairing, ({ spec, sourceKey, targetKeys }) => {
        const compiledBase = compile(spec);
        const { spec: once } = setLinks(spec, {
          sourceKey,
          targetKeys,
          priorFlows: compiledBase.flows,
        });
        const compiledOnce = compile(once, { prior: compiledBase.flows });
        const { spec: twice } = setLinks(once, {
          sourceKey,
          targetKeys,
          priorFlows: compiledOnce.flows,
        });
        const compiledTwice = compile(twice, { prior: compiledOnce.flows });
        expect(canonicalJson(compiledOnce.flows)).toBe(canonicalJson(compiledTwice.flows));
        expect(compiledOnce.hash).toBe(compiledTwice.hash);
      }),
      { numRuns: Math.min(NUM_RUNS, 200) },
    );
  });
});
