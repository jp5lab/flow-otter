import { describe, expect, it } from 'vitest';

import { addStatusNode } from '../../../../../src/toolkit/authoring/operations/add-status-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [{ key: 'existing', type: 'inject', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('addStatusNode', () => {
  it('adds exactly one status node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addStatusNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('status');
  });

  it('throws when tab is not found', () => {
    expect(() => addStatusNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'status', type: 'status', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addStatusNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('status');
    expect(newNodeKey).toBe('status-2');
  });
});
