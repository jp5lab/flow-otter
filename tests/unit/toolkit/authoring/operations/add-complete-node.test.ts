import { describe, expect, it } from 'vitest';

import { addCompleteNode } from '../../../../../src/toolkit/authoring/operations/add-complete-node.js';
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

describe('addCompleteNode', () => {
  it('adds exactly one complete node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addCompleteNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('complete');
  });

  it('throws when tab is not found', () => {
    expect(() => addCompleteNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'complete', type: 'complete', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addCompleteNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('complete');
    expect(newNodeKey).toBe('complete-2');
  });
});
