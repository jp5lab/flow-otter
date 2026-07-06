import { describe, expect, it } from 'vitest';

import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import { layoutFlows, layoutTabs } from '../../../../src/toolkit/layout/index.js';

function specWithNodes(count: number): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tabA',
        label: 'Tab A',
        nodes: Array.from({ length: count }, (_, i) => ({
          key: `n${i}`,
          type: 'inject',
          position: { x: 0, y: 0 },
        })),
        connections: [],
        groups: [],
        comments: [],
      },
    ],
  };
}

function specWithGroup(): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tabA',
        label: 'Tab A',
        nodes: [
          { key: 'a', type: 'inject', position: { x: 0, y: 0 } },
          { key: 'b', type: 'debug', position: { x: 0, y: 0 } },
        ],
        connections: [{ fromKey: 'a', outputPort: 0, toKey: 'b' }],
        groups: [{ key: 'g1', name: 'Group', nodeKeys: ['a', 'b'] }],
        comments: [],
      },
    ],
  };
}

function specWithManyOutputs(): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tabA',
        label: 'Tab A',
        nodes: [
          { key: 'router', type: 'switch', position: { x: 0, y: 0 }, passthrough: { outputs: 4 } },
          { key: 'a', type: 'debug', position: { x: 0, y: 0 } },
        ],
        connections: [{ fromKey: 'router', outputPort: 0, toKey: 'a' }],
        groups: [],
        comments: [],
      },
    ],
  };
}

function specWithRulesOnlySwitch(): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tabA',
        label: 'Tab A',
        nodes: [
          {
            key: 'router',
            type: 'switch',
            position: { x: 0, y: 0 },
            passthrough: {
              rules: [{ t: 'eq' }, { t: 'neq' }, { t: 'lt' }, { t: 'else' }],
            },
          },
          { key: 'a', type: 'debug', position: { x: 0, y: 0 } },
        ],
        connections: [{ fromKey: 'router', outputPort: 0, toKey: 'a' }],
        groups: [],
        comments: [],
      },
    ],
  };
}

describe('layoutFlows auto-engine selection', () => {
  it('routes auto through the two-level ELK engine even for small flows', async () => {
    const source = specWithNodes(3);
    const auto = await layoutFlows(source, { engine: 'auto' });
    const explicit = await layoutTabs(source);

    expect(JSON.stringify(auto)).toBe(JSON.stringify(explicit));
  });

  it('routes large flows through the same two-level ELK default', async () => {
    const source = specWithNodes(30);
    const auto = await layoutFlows(source, { engine: 'auto' });
    const explicit = await layoutTabs(source);

    expect(JSON.stringify(auto)).toBe(JSON.stringify(explicit));
  });

  it('keeps grouped and many-output flows on the two-level ELK default', async () => {
    const groupedAuto = await layoutFlows(specWithGroup(), { engine: 'auto' });
    const groupedExplicit = await layoutTabs(specWithGroup());
    const manyOutputsAuto = await layoutFlows(specWithManyOutputs(), { engine: 'auto' });
    const manyOutputsExplicit = await layoutTabs(specWithManyOutputs());

    expect(JSON.stringify(groupedAuto)).toBe(JSON.stringify(groupedExplicit));
    expect(JSON.stringify(manyOutputsAuto)).toBe(JSON.stringify(manyOutputsExplicit));
  });

  it('does not need output-count heuristics for rules-only switches on auto', async () => {
    const source = specWithRulesOnlySwitch();
    const auto = await layoutFlows(source, { engine: 'auto' });
    const explicit = await layoutTabs(source);

    expect(JSON.stringify(auto)).toBe(JSON.stringify(explicit));
  });

  it('respects explicit engine:"dagre" as the legacy fallback even on a large flow', async () => {
    const out = await layoutFlows(specWithNodes(40), { engine: 'dagre' });
    expect(out.tabs[0]!.nodes).toHaveLength(40);
  });

  it('respects explicit engine:"elk" override even on a tiny flow', async () => {
    const out = await layoutFlows(specWithNodes(2), { engine: 'elk' });
    expect(out.tabs[0]!.nodes).toHaveLength(2);
  });
});
