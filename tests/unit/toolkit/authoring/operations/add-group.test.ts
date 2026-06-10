import { describe, expect, it } from 'vitest';

import { addGroup } from '../../../../../src/toolkit/authoring/operations/add-group.js';
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

describe('addGroup', () => {
  it('adds exactly one group with the given name and propagates nodeKeys', () => {
    const { spec, newGroupKey } = addGroup(baseSpec, 'tab-main', {
      name: 'My Group',
      nodeKeys: ['existing'],
    });
    const tab = spec.tabs[0]!;
    expect(tab.groups.length).toBe(1);
    expect(tab.nodes.length).toBe(1);
    const inserted = tab.groups.find((g) => g.key === newGroupKey);
    expect(inserted?.name).toBe('My Group');
    expect(inserted?.nodeKeys).toEqual(['existing']);
    expect(tab.nodes[0]?.groupKey).toBe(newGroupKey);
    expect(newGroupKey).toBe('group');
  });

  it('throws when tab is not found', () => {
    expect(() => addGroup(baseSpec, 'missing', { name: 'X' })).toThrow();
  });

  it('uses a unique key suffix when default base key collides', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [],
          connections: [],
          groups: [{ key: 'group', name: 'Existing', nodeKeys: [] }],
          comments: [],
        },
      ],
    };
    const { newGroupKey } = addGroup(spec, 'tab-main', { name: 'Another' });
    expect(newGroupKey).not.toBe('group');
    expect(newGroupKey).toBe('group-2');
  });

  it('defaults nodeKeys to empty array when omitted', () => {
    const { spec, newGroupKey } = addGroup(baseSpec, 'tab-main', { name: 'Empty' });
    const inserted = spec.tabs[0]!.groups.find((g) => g.key === newGroupKey);
    expect(inserted?.nodeKeys).toEqual([]);
  });

  it('honors explicit group geometry and metadata', () => {
    const { spec, newGroupKey } = addGroup(baseSpec, 'tab-main', {
      name: 'Nested',
      nodeKeys: ['existing'],
      position: { x: 60, y: 80 },
      size: { w: 320, h: 180 },
      parentKey: 'parent',
      info: 'Operator-facing section notes',
      style: { fill: '#f5f5f5' },
    });
    const inserted = spec.tabs[0]!.groups.find((g) => g.key === newGroupKey);
    expect(inserted).toMatchObject({
      name: 'Nested',
      nodeKeys: ['existing'],
      position: { x: 60, y: 80 },
      size: { w: 320, h: 180 },
      parentKey: 'parent',
      info: 'Operator-facing section notes',
      style: { fill: '#f5f5f5' },
    });
  });

  it('moves claimed members out of any prior group', () => {
    const spec: AuthoringSpec = {
      tabs: [
        {
          id: 'tab-main',
          label: 'Main',
          nodes: [
            { key: 'existing', type: 'function', position: { x: 100, y: 100 }, groupKey: 'old' },
          ],
          connections: [],
          groups: [{ key: 'old', name: 'Old', nodeKeys: ['existing'] }],
          comments: [],
        },
      ],
    };

    const { spec: updated, newGroupKey } = addGroup(spec, 'tab-main', {
      name: 'New',
      nodeKeys: ['existing'],
    });

    const tab = updated.tabs[0]!;
    expect(tab.nodes[0]?.groupKey).toBe(newGroupKey);
    expect(tab.groups.find((g) => g.key === 'old')?.nodeKeys).toEqual([]);
    expect(tab.groups.find((g) => g.key === newGroupKey)?.nodeKeys).toEqual(['existing']);
  });
});
