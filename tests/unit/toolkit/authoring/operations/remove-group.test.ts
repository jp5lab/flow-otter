import { describe, expect, it } from 'vitest';

import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import { removeGroup } from '../../../../../src/toolkit/authoring/operations/remove-group.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [{ key: 'a', type: 'inject', position: { x: 140, y: 200 }, groupKey: 'child' }],
      connections: [],
      groups: [
        { key: 'parent', name: 'Parent', nodeKeys: [], position: { x: 40, y: 60 } },
        {
          key: 'child',
          name: 'Child',
          nodeKeys: ['a', 'j1', 'note'],
          parentKey: 'parent',
          position: { x: 80, y: 100 },
          size: { w: 360, h: 160 },
        },
        {
          key: 'grandchild',
          name: 'Grandchild',
          nodeKeys: [],
          parentKey: 'child',
          position: { x: 120, y: 140 },
          size: { w: 160, h: 80 },
        },
      ],
      comments: [{ key: 'note', text: 'note', position: { x: 240, y: 120 }, groupKey: 'child' }],
      junctions: [{ key: 'j1', position: { x: 260, y: 200 }, groupKey: 'child' }],
    },
  ],
};

describe('removeGroup', () => {
  it('ungroups by reparenting direct members and child groups to the parent group', () => {
    const { spec, removed } = removeGroup(baseSpec, 'tab-main', 'child');
    expect(removed).toBe(true);
    const tab = spec.tabs[0]!;
    expect(tab.groups.map((g) => g.key)).toEqual(['parent', 'grandchild']);
    expect(tab.groups.find((g) => g.key === 'parent')?.nodeKeys).toEqual(['a', 'j1', 'note']);
    expect(tab.groups.find((g) => g.key === 'grandchild')?.parentKey).toBe('parent');
    expect(tab.nodes[0]!.groupKey).toBe('parent');
    expect(tab.junctions?.[0]!.groupKey).toBe('parent');
    expect(tab.comments[0]!.groupKey).toBe('parent');
  });

  it('ungroups top-level members without deleting them', () => {
    const topLevel: AuthoringSpec = {
      ...baseSpec,
      tabs: [
        {
          ...baseSpec.tabs[0]!,
          groups: baseSpec.tabs[0]!.groups.filter((g) => g.key !== 'parent').map((g) =>
            g.key === 'child'
              ? {
                  key: g.key,
                  name: g.name,
                  nodeKeys: g.nodeKeys,
                  ...(g.position !== undefined ? { position: g.position } : {}),
                  ...(g.size !== undefined ? { size: g.size } : {}),
                }
              : g,
          ),
        },
      ],
    };
    const { spec } = removeGroup(topLevel, 'tab-main', 'child');
    const tab = spec.tabs[0]!;
    expect(tab.nodes.map((n) => n.key)).toEqual(['a']);
    expect(tab.junctions?.map((j) => j.key)).toEqual(['j1']);
    expect(tab.comments.map((c) => c.key)).toEqual(['note']);
    expect(tab.nodes[0]!.groupKey).toBeUndefined();
    expect(tab.junctions?.[0]!.groupKey).toBeUndefined();
    expect(tab.comments[0]!.groupKey).toBeUndefined();
    expect(tab.groups.find((g) => g.key === 'grandchild')?.parentKey).toBeUndefined();
  });

  it('preserves every surviving compiled id when compiled with prior flows', () => {
    const prior = compile(baseSpec);
    const { spec } = removeGroup(baseSpec, 'tab-main', 'child');
    const next = compile(spec, { prior: prior.flows });

    const priorByKey = new Map(
      prior.flows
        .map((n) => [(n as Record<string, unknown>)['_authoringKey'], n.id] as const)
        .filter(([key]) => typeof key === 'string'),
    );
    for (const node of next.flows) {
      const key = (node as Record<string, unknown>)['_authoringKey'];
      if (typeof key !== 'string') continue;
      expect(node.id).toBe(priorByKey.get(key));
    }
  });

  it('throws when tab or group is not found', () => {
    expect(() => removeGroup(baseSpec, 'missing', 'child')).toThrow();
    expect(() => removeGroup(baseSpec, 'tab-main', 'missing')).toThrow();
  });
});
