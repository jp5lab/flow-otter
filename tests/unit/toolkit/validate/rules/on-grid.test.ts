import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/on-grid.js';

describe('on-grid', () => {
  it('passes for grid-aligned positions', () => {
    expect(
      check([{ id: 'a', type: 'inject', z: 'tab1', x: 100, y: 80, wires: [] }] as never),
    ).toEqual([]);
  });

  it('warns for off-grid positions', () => {
    const out = check([{ id: 'a', type: 'inject', z: 'tab1', x: 103, y: 80, wires: [] }] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
  });

  it('errors on non-finite positions', () => {
    const out = check([
      { id: 'a', type: 'inject', z: 'tab1', x: Number.NaN, y: 80, wires: [] },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
  });
});
