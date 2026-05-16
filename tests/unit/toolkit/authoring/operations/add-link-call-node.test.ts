import { describe, expect, it } from 'vitest';

import { addLinkCallNode } from '../../../../../src/toolkit/authoring/operations/add-link-call-node.js';
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

describe('addLinkCallNode', () => {
  it('adds exactly one link call node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addLinkCallNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('link call');
  });

  it('throws when tab is not found', () => {
    expect(() => addLinkCallNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'link-call', type: 'link call', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addLinkCallNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('link-call');
    expect(newNodeKey).toBe('link-call-2');
  });
});
