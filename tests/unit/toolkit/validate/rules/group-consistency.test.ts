import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/group-consistency.js';

describe('group-consistency', () => {
  it("passes when group.nodes matches members' g field", () => {
    expect(
      check([
        { id: 'tab1', type: 'tab', label: 'Tab' },
        {
          id: 'g1',
          type: 'group',
          z: 'tab1',
          name: 'G',
          nodes: ['n1', 'n2'],
        },
        { id: 'n1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], g: 'g1' },
        { id: 'n2', type: 'debug', z: 'tab1', x: 0, y: 0, wires: [], g: 'g1' },
      ] as never),
    ).toEqual([]);
  });

  it('flags member listed in group but with wrong g', () => {
    const out = check([
      { id: 'g1', type: 'group', z: 'tab1', name: 'G', nodes: ['n1'] },
      { id: 'n1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], g: 'g2' },
    ] as never);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((d) => d.severity === 'error')).toBe(true);
  });

  it('flags node with g pointing to group that does not list it', () => {
    const out = check([
      { id: 'g1', type: 'group', z: 'tab1', name: 'G', nodes: [] },
      { id: 'n1', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], g: 'g1' },
    ] as never);
    expect(out.some((d) => d.message.includes('does not list'))).toBe(true);
  });
});
