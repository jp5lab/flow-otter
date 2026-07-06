import { describe, expect, it } from 'vitest';

import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import { updateGroup } from '../../../../../src/toolkit/authoring/operations/update-group.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [
        { key: 'a', type: 'inject', position: { x: 140, y: 200 }, groupKey: 'g1' },
        { key: 'b', type: 'debug', position: { x: 540, y: 200 } },
      ],
      connections: [],
      groups: [
        {
          key: 'g1',
          name: 'Old',
          nodeKeys: ['a'],
          position: { x: 80, y: 140 },
          size: { w: 520, h: 120 },
          info: 'old info',
          style: { fill: '#eeeeee' },
        },
      ],
      comments: [{ key: 'note', text: 'note', position: { x: 340, y: 120 } }],
      junctions: [{ key: 'j1', position: { x: 340, y: 200 } }],
    },
  ],
};

function groupNode(flows: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  const group = flows.find((n) => n['type'] === 'group');
  expect(group).toBeDefined();
  return group!;
}

describe('updateGroup', () => {
  it('updates metadata and member groupKey fields', () => {
    const { spec, updated } = updateGroup(baseSpec, 'tab-main', 'g1', {
      name: 'New',
      nodeKeys: ['b', 'j1', 'note'],
      parentKey: 'parent',
      info: 'new info',
      style: { fill: '#fafafa' },
    });

    expect(updated).toBe(true);
    const tab = spec.tabs[0]!;
    expect(tab.groups[0]).toMatchObject({
      key: 'g1',
      name: 'New',
      nodeKeys: ['b', 'j1', 'note'],
      parentKey: 'parent',
      info: 'new info',
      style: { fill: '#fafafa' },
    });
    expect(tab.nodes.find((n) => n.key === 'a')?.groupKey).toBeUndefined();
    expect(tab.nodes.find((n) => n.key === 'b')?.groupKey).toBe('g1');
    expect(tab.junctions?.find((j) => j.key === 'j1')?.groupKey).toBe('g1');
    expect(tab.comments.find((c) => c.key === 'note')?.groupKey).toBe('g1');
  });

  it('refit:true strips explicit geometry so compile auto-fits from current members', () => {
    const { spec } = updateGroup(baseSpec, 'tab-main', 'g1', {
      nodeKeys: ['a', 'b', 'j1', 'note'],
      refit: true,
    });
    expect(spec.tabs[0]!.groups[0]!.position).toBeUndefined();
    expect(spec.tabs[0]!.groups[0]!.size).toBeUndefined();

    const expectedSpec: AuthoringSpec = {
      ...baseSpec,
      tabs: [
        {
          ...baseSpec.tabs[0]!,
          groups: [
            {
              key: 'g1',
              name: 'Old',
              nodeKeys: ['a', 'b', 'j1', 'note'],
              info: 'old info',
              style: { fill: '#eeeeee' },
            },
          ],
          nodes: baseSpec.tabs[0]!.nodes.map((n) => (n.key === 'b' ? { ...n, groupKey: 'g1' } : n)),
          comments: baseSpec.tabs[0]!.comments.map((c) => ({ ...c, groupKey: 'g1' })),
          ...(baseSpec.tabs[0]!.junctions !== undefined
            ? { junctions: baseSpec.tabs[0]!.junctions.map((j) => ({ ...j, groupKey: 'g1' })) }
            : {}),
        },
      ],
    };
    const actualGroup = groupNode(compile(spec).flows);
    const expectedGroup = groupNode(compile(expectedSpec).flows);
    expect({
      x: actualGroup['x'],
      y: actualGroup['y'],
      w: actualGroup['w'],
      h: actualGroup['h'],
    }).toEqual({
      x: expectedGroup['x'],
      y: expectedGroup['y'],
      w: expectedGroup['w'],
      h: expectedGroup['h'],
    });
  });

  it('throws when tab or group is not found', () => {
    expect(() => updateGroup(baseSpec, 'missing', 'g1', { name: 'X' })).toThrow();
    expect(() => updateGroup(baseSpec, 'tab-main', 'missing', { name: 'X' })).toThrow();
  });
});
