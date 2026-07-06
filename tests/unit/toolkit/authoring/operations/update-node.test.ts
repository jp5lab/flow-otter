import { describe, expect, it } from 'vitest';

import { updateNode } from '../../../../../src/toolkit/authoring/operations/update-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [
        {
          key: 'fn',
          type: 'function',
          label: 'Old',
          position: { x: 100, y: 100 },
          groupKey: 'g1',
          passthrough: { func: 'return msg;', outputs: 1 },
        },
      ],
      connections: [],
      groups: [{ key: 'g1', name: 'G', nodeKeys: ['fn', 'j1', 'note'] }],
      comments: [{ key: 'note', text: 'Old note', position: { x: 180, y: 180 }, groupKey: 'g1' }],
      junctions: [
        { key: 'j1', position: { x: 200, y: 160 }, name: 'Old junction', groupKey: 'g1' },
      ],
    },
  ],
};

describe('updateNode', () => {
  it('updates only the fields that are present in opts', () => {
    const { spec, updated } = updateNode(baseSpec, 'tab-main', 'fn', { label: 'New' });
    expect(updated).toBe(true);
    const node = spec.tabs[0]!.nodes[0]!;
    expect(node.label).toBe('New');
    expect(node.position).toEqual({ x: 100, y: 100 });
    expect(node.groupKey).toBe('g1');
    expect(node.passthrough).toEqual({ func: 'return msg;', outputs: 1 });
  });

  it('replaces passthrough wholesale (no merge)', () => {
    const { spec } = updateNode(baseSpec, 'tab-main', 'fn', {
      passthrough: { func: 'return null;' },
    });
    expect(spec.tabs[0]!.nodes[0]!.passthrough).toEqual({ func: 'return null;' });
  });

  it('clears groupKey when groupKey is null and leaves it when undefined', () => {
    const cleared = updateNode(baseSpec, 'tab-main', 'fn', { groupKey: null });
    expect(cleared.spec.tabs[0]!.nodes[0]!.groupKey).toBeUndefined();
    expect(cleared.spec.tabs[0]!.groups[0]!.nodeKeys).toEqual(['j1', 'note']);
    const left = updateNode(baseSpec, 'tab-main', 'fn', { label: 'X' });
    expect(left.spec.tabs[0]!.nodes[0]!.groupKey).toBe('g1');
  });

  it('updates junction fields and keeps junction connections addressable', () => {
    const { spec, updated } = updateNode(baseSpec, 'tab-main', 'j1', {
      label: 'New junction',
      position: { x: 260, y: 180 },
      disabled: true,
      groupKey: null,
    });

    expect(updated).toBe(true);
    expect(spec.tabs[0]!.junctions?.[0]).toEqual({
      key: 'j1',
      position: { x: 260, y: 180 },
      name: 'New junction',
      disabled: true,
    });
    expect(spec.tabs[0]!.groups[0]!.nodeKeys).toEqual(['fn', 'note']);
  });

  it('rejects passthrough updates on junctions', () => {
    expect(() =>
      updateNode(baseSpec, 'tab-main', 'j1', { passthrough: { unexpected: true } }),
    ).toThrow(/passthrough/i);
  });

  it('updates comment text and position through the legacy node updater', () => {
    const { spec, updated } = updateNode(baseSpec, 'tab-main', 'note', {
      label: 'New note',
      position: { x: 220, y: 220 },
      groupKey: null,
    });

    expect(updated).toBe(true);
    expect(spec.tabs[0]!.comments[0]).toMatchObject({
      key: 'note',
      text: 'New note',
      position: { x: 220, y: 220 },
    });
    expect(spec.tabs[0]!.comments[0]!.groupKey).toBeUndefined();
    expect(spec.tabs[0]!.groups[0]!.nodeKeys).toEqual(['fn', 'j1']);
  });

  it('rejects passthrough updates on comments', () => {
    expect(() =>
      updateNode(baseSpec, 'tab-main', 'note', { passthrough: { unexpected: true } }),
    ).toThrow(/passthrough/i);
  });

  it('throws when the object is absent', () => {
    expect(() => updateNode(baseSpec, 'tab-main', 'missing', { label: 'X' })).toThrow();
  });

  it('throws when the tab is missing', () => {
    expect(() => updateNode(baseSpec, 'nope', 'fn', { label: 'X' })).toThrow();
  });

  it('does not mutate the input spec', () => {
    const before = JSON.stringify(baseSpec);
    updateNode(baseSpec, 'tab-main', 'fn', { label: 'New', position: { x: 200, y: 200 } });
    expect(JSON.stringify(baseSpec)).toBe(before);
  });
});
