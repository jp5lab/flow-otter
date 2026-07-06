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
        { fromKey: 'src', outputPort: 0, toKey: 'j1' },
        { fromKey: 'j1', outputPort: 0, toKey: 'mover' },
      ],
      groups: [{ key: 'g1', name: 'G', nodeKeys: ['mover', 'j1', 'note'] }],
      comments: [{ key: 'note', text: 'Note', position: { x: 160, y: 180 }, groupKey: 'g1' }],
      junctions: [{ key: 'j1', position: { x: 160, y: 100 }, groupKey: 'g1' }],
    },
    {
      id: 'tab-b',
      label: 'B',
      nodes: [],
      connections: [],
      groups: [],
      comments: [],
      junctions: [],
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

  it('repositions a junction within the same tab and preserves connections', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'j1', {
      position: { x: 213, y: 147 },
    });
    const tab = spec.tabs[0]!;
    expect(tab.junctions?.find((j) => j.key === 'j1')?.position).toEqual({ x: 220, y: 140 });
    expect(tab.connections).toEqual(twoTabSpec.tabs[0]!.connections);
  });

  it('repositions a comment within the same tab', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'note', {
      position: { x: 233, y: 209 },
    });
    expect(spec.tabs[0]!.comments.find((c) => c.key === 'note')?.position).toEqual({
      x: 240,
      y: 200,
    });
  });

  it('moves across tabs, drops groupKey, and removes related connections from source', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'mover', {
      destTabId: 'tab-b',
      position: { x: 50, y: 50 },
    });
    const sourceTab = spec.tabs[0]!;
    const destTab = spec.tabs[1]!;
    expect(sourceTab.nodes.map((n) => n.key)).toEqual(['src']);
    expect(sourceTab.connections).toEqual([{ fromKey: 'src', outputPort: 0, toKey: 'j1' }]);
    expect(sourceTab.groups[0]!.nodeKeys).toEqual(['j1', 'note']);
    expect(destTab.nodes.length).toBe(1);
    const moved = destTab.nodes[0]!;
    expect(moved.key).toBe('mover');
    expect(moved.position).toEqual({ x: 60, y: 60 });
    expect(moved.groupKey).toBeUndefined();
  });

  it('moves a junction across tabs and scrubs source connections and group membership', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'j1', {
      destTabId: 'tab-b',
      position: { x: 50, y: 50 },
    });

    const sourceTab = spec.tabs[0]!;
    const destTab = spec.tabs[1]!;
    expect(sourceTab.junctions).toEqual([]);
    expect(sourceTab.connections).toEqual([
      { fromKey: 'src', outputPort: 0, toKey: 'mover' },
      { fromKey: 'mover', outputPort: 0, toKey: 'src' },
    ]);
    expect(sourceTab.groups[0]!.nodeKeys).toEqual(['mover', 'note']);
    expect(destTab.junctions).toEqual([{ key: 'j1', position: { x: 60, y: 60 } }]);
  });

  it('moves a comment across tabs and scrubs source group membership', () => {
    const { spec } = moveNode(twoTabSpec, 'tab-a', 'note', {
      destTabId: 'tab-b',
      position: { x: 50, y: 50 },
    });

    const sourceTab = spec.tabs[0]!;
    const destTab = spec.tabs[1]!;
    expect(sourceTab.comments).toEqual([]);
    expect(sourceTab.groups[0]!.nodeKeys).toEqual(['mover', 'j1']);
    expect(destTab.comments).toEqual([{ key: 'note', text: 'Note', position: { x: 60, y: 60 } }]);
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
