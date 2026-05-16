import { describe, expect, it } from 'vitest';

import { addCatchNode } from '../../../../../src/toolkit/authoring/operations/add-catch-node.js';
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

describe('addCatchNode', () => {
  it('adds exactly one catch node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addCatchNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('catch');
  });

  it('throws when tab is not found', () => {
    expect(() => addCatchNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'catch', type: 'catch', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addCatchNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('catch');
    expect(newNodeKey).toBe('catch-2');
  });
});
