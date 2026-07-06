import { describe, expect, it } from 'vitest';

import { addDebugNode } from '../../../../../src/toolkit/authoring/operations/add-debug-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [{ key: 'inj', type: 'inject', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('addDebugNode', () => {
  it('adds exactly one debug node + one connection', () => {
    const { spec, newNodeKey } = addDebugNode(baseSpec, 'tab-main', 'inj');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(1);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('debug');
  });

  it('places new node one width-aware pitch right of source', () => {
    const { spec } = addDebugNode(baseSpec, 'tab-main', 'inj');
    const debugNode = spec.tabs[0]!.nodes.find((n) => n.type === 'debug')!;
    expect(debugNode.position.x).toBe(260);
    expect(debugNode.position.y).toBe(100);
  });

  it('does not mutate input', () => {
    const before = JSON.stringify(baseSpec);
    addDebugNode(baseSpec, 'tab-main', 'inj');
    expect(JSON.stringify(baseSpec)).toBe(before);
  });

  it('throws when source node is not found', () => {
    expect(() => addDebugNode(baseSpec, 'tab-main', 'nope')).toThrow();
  });

  it('throws when tab is not found', () => {
    expect(() => addDebugNode(baseSpec, 'nope', 'inj')).toThrow();
  });

  it('inherits group membership from source', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            {
              key: 'inj',
              type: 'inject',
              position: { x: 100, y: 100 },
              groupKey: 'g1',
            },
          ],
          connections: [],
          groups: [{ key: 'g1', name: 'G', nodeKeys: ['inj'] }],
          comments: [],
        },
      ],
    };
    const { spec: out } = addDebugNode(spec, 'tab-main', 'inj');
    const dbg = out.tabs[0]!.nodes.find((n) => n.type === 'debug')!;
    expect(dbg.groupKey).toBe('g1');
  });

  it('uses unique key suffix when collision exists', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            { key: 'inj', type: 'inject', position: { x: 100, y: 100 } },
            { key: 'inj__debug', type: 'debug', position: { x: 200, y: 100 } },
          ],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addDebugNode(spec, 'tab-main', 'inj');
    expect(newNodeKey).not.toBe('inj__debug');
  });
});
