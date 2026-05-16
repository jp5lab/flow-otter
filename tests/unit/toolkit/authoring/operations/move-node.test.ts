import { describe, expect, it } from 'vitest';

import { moveNode } from '../../../../../src/toolkit/authoring/operations/move-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const twoTabSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-a',
      label: 'A',
      nodes: [
        { key: 'src', type: 'inject', position: { x: 100, y: 100 } },
        {
          key: 'mover',
          type: 'function',
          position: { x: 200, y: 100 },
          groupKey: 'g1',
        },
      ],
      connections: [
        { fromKey: 'src', outputPort: 0, toKey: 'mover' },
        { fromKey: 'mover', outputPort: 0, toKey: 'src' },
      ],
      groups: [{ key: 'g1', name: 'G', nodeKeys: ['mover'] }],
      comments: [],
    },
    {
      id: 'tab-b',
      label: 'B',
      nodes: [],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

describe('moveNode', () => {
  it('repositions a node within the same tab and snaps to grid', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'mover', {
      position: { x: 313, y: 207 },
    });
    const node = spec.tabs[0]!.nodes.find((n) => n.key === 'mover')!;
    expect(node.position).toEqual({ x: 320, y: 200 });
    expect(spec.tabs[0]!.nodes.length).toBe(2);
    expect(spec.tabs[1]!.nodes.length).toBe(0);
  });

  it('moves across tabs, drops groupKey, and removes related connections from source', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'mover', {
      destTabId: 'tab-b',
      position: { x: 50, y: 50 },
    });
    const sourceTab = spec.tabs[0]!;
    const destTab = spec.tabs[1]!;
    expect(sourceTab.nodes.map((n) => n.key)).toEqual(['src']);
    expect(sourceTab.connections).toEqual([]);
    expect(sourceTab.groups[0]!.nodeKeys).toEqual([]);
    expect(destTab.nodes.length).toBe(1);
    const moved = destTab.nodes[0]!;
    expect(moved.key).toBe('mover');
    expect(moved.position).toEqual({ x: 60, y: 60 });
    expect(moved.groupKey).toBeUndefined();
  });

  it('keeps the existing position when opts.position is omitted (still snaps it)', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'mover');
    const node = spec.tabs[0]!.nodes.find((n) => n.key === 'mover')!;
    expect(node.position).toEqual({ x: 200, y: 100 });
  });

  it('throws when source tab, node, or destination tab are missing', () => {
    expect(() => moveNode(twoTabSpec, 'missing', 'mover')).toThrow();
    expect(() => moveNode(twoTabSpec, 'tab-a', 'nope')).toThrow();
    expect(() => moveNode(twoTabSpec, 'tab-a', 'mover', { destTabId: 'no-such-tab' })).toThrow();
  });

  it('throws when destination tab already contains a node with the same key', () => {
    const conflicting: AuthoringSpec = {
      tabs: [
        twoTabSpec.tabs[0]!,
        {
          ...twoTabSpec.tabs[1]!,
          nodes: [{ key: 'mover', type: 'debug', position: { x: 0, y: 0 } }],
        },
      ],
    };
    expect(() => moveNode(conflicting, 'tab-a', 'mover', { destTabId: 'tab-b' })).toThrow();
  });
});
