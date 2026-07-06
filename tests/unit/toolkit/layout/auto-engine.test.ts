import { describe, expect, it } from 'vitest';

import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import { layoutFlows } from '../../../../src/toolkit/layout/index.js';

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
  it('returns a laid-out spec for small flows (dagre path)', async () => {
    const out = await layoutFlows(specWithNodes(3), { engine: 'auto' });
    expect(out.tabs[0]!.nodes).toHaveLength(3);
  });

  it('escalates to ELK when nodes >= 30', async () => {
    const out = await layoutFlows(specWithNodes(30), { engine: 'auto' });
    expect(out.tabs[0]!.nodes).toHaveLength(30);
    // ELK runs async; if dispatch went wrong this would throw or return
    // unchanged positions. Sanity check: some node got a non-zero x.
    expect(out.tabs[0]!.nodes.some((n) => n.position.x !== 0)).toBe(true);
  });

  it('escalates to ELK when a group is present', async () => {
    const out = await layoutFlows(specWithGroup(), { engine: 'auto' });
    expect(out.tabs[0]!.nodes).toHaveLength(2);
    expect(out.tabs[0]!.nodes.some((n) => n.position.x !== 0)).toBe(true);
  });

  it('escalates to ELK when a node has >= 4 outputs', async () => {
    const out = await layoutFlows(specWithManyOutputs(), { engine: 'auto' });
    expect(out.tabs[0]!.nodes).toHaveLength(2);
  });

  it('counts switch rules when auto-selecting for many outputs', async () => {
    const spec = specWithRulesOnlySwitch();
    const auto = await layoutFlows(spec, { engine: 'auto' });
    const explicit = await layoutFlows(spec, { engine: 'elk' });
    expect(JSON.stringify(auto)).toBe(JSON.stringify(explicit));
  });

  it('respects explicit engine:"dagre" override even on a large flow', async () => {
    const out = await layoutFlows(specWithNodes(40), { engine: 'dagre' });
    expect(out.tabs[0]!.nodes).toHaveLength(40);
  });

  it('respects explicit engine:"elk" override even on a tiny flow', async () => {
    const out = await layoutFlows(specWithNodes(2), { engine: 'elk' });
    expect(out.tabs[0]!.nodes).toHaveLength(2);
  });
});
