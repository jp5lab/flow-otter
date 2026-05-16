import { describe, expect, it } from 'vitest';

import { addFunctionNode } from '../../../../../src/toolkit/authoring/operations/add-function-node.js';
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

describe('addFunctionNode', () => {
  it('adds exactly one function node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addFunctionNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('function');
  });

  it('throws when tab is not found', () => {
    expect(() => addFunctionNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'function', type: 'function', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addFunctionNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('function');
    expect(newNodeKey).toBe('function-2');
  });
});
