import { describe, expect, it } from 'vitest';

import { addJunction } from '../../../../../src/toolkit/authoring/operations/add-junction.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';

const baseSpec: AuthoringSpec = {
  tabs: [
    {
      id: 'tab-main',
      label: 'Main',
      nodes: [{ key: 'src', type: 'inject', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [{ key: 'g1', name: 'Group', nodeKeys: [] }],
      comments: [],
    },
  ],
};

describe('addJunction', () => {
  it('adds a minimal junction with a stable key and snapped position', () => {
    const { spec, newJunctionKey } = addJunction(baseSpec, 'tab-main', {
      key: 'route',
      position: { x: 213, y: 106 },
      name: 'Route',
      groupKey: 'g1',
      disabled: true,
    });

    expect(newJunctionKey).toBe('route');
    const tab = spec.tabs[0]!;
    expect(tab.junctions).toEqual([
      {
        key: 'route',
        position: { x: 220, y: 100 },
        name: 'Route',
        groupKey: 'g1',
        disabled: true,
      },
    ]);
    expect(tab.groups[0]!.nodeKeys).toEqual(['route']);
  });

  it('uses a unique key suffix when the base key collides', () => {
    const first = addJunction(baseSpec, 'tab-main', { key: 'route' });
    const second = addJunction(first.spec, 'tab-main', { key: 'route' });
    expect(second.newJunctionKey).toBe('route-2');
  });

  it('throws when tab is not found', () => {
    expect(() => addJunction(baseSpec, 'missing', {})).toThrow();
  });
});
