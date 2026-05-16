import { describe, expect, it } from 'vitest';

import { addLinkInNode } from '../../../../../src/toolkit/authoring/operations/add-link-in-node.js';
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

describe('addLinkInNode', () => {
  it('adds exactly one link in node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addLinkInNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('link in');
  });

  it('throws when tab is not found', () => {
    expect(() => addLinkInNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'link-in', type: 'link in', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addLinkInNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('link-in');
    expect(newNodeKey).toBe('link-in-2');
  });
});
