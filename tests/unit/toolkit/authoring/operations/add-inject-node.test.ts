import { describe, expect, it } from 'vitest';

import { addInjectNode } from '../../../../../src/toolkit/authoring/operations/add-inject-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [{ key: 'existing', type: 'function', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('addInjectNode', () => {
  it('adds exactly one inject node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addInjectNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('inject');
  });

  it('throws when tab is not found', () => {
    expect(() => addInjectNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'inject', type: 'inject', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addInjectNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('inject');
    expect(newNodeKey).toBe('inject-2');
  });

  it('places the new node at {80,80} when the tab is empty', () => {
    const empty: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-empty',
          label: 'Empty',
          nodes: [],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { spec } = addInjectNode(empty, 'tab-empty');
    const node = spec.tabs[0]!.nodes[0]!;
    expect(node.position.x).toBe(80);
    expect(node.position.y).toBe(80);
  });
});
