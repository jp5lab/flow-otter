import { describe, expect, it } from 'vitest';

import { addLinkOutNode } from '../../../../../src/toolkit/authoring/operations/add-link-out-node.js';
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

describe('addLinkOutNode', () => {
  it('adds exactly one link out node and leaves connections untouched', () => {
    const { spec, newNodeKey } = addLinkOutNode(baseSpec, 'tab-main');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.length).toBe(2);
    expect(tab.connections.length).toBe(0);
    expect(tab.nodes.find((n) => n.key === newNodeKey)?.type).toBe('link out');
  });

  it('throws when tab is not found', () => {
    expect(() => addLinkOutNode(baseSpec, 'missing')).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [{ key: 'link-out', type: 'link out', position: { x: 100, y: 100 } }],
          connections: [],
          groups: [],
          comments: [],
        },
      ],
    };
    const { newNodeKey } = addLinkOutNode(spec, 'tab-main');
    expect(newNodeKey).not.toBe('link-out');
    expect(newNodeKey).toBe('link-out-2');
  });
});
