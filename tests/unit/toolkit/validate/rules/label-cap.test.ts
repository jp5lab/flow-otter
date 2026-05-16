import { describe, expect, it } from 'vitest';

import { check } from '../../../../../src/toolkit/validate/rules/label-cap.js';

describe('label-cap', () => {
  it('allows labels at the cap', () => {
    expect(
      check([
        { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], name: 'a'.repeat(24) },
      ] as never),
    ).toEqual([]);
  });

  it('warns for labels above the cap', () => {
    const out = check([
      { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [], name: 'a'.repeat(25) },
    ] as never);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
  });

  it('does not flag long comment text (sticky-note exception)', () => {
    expect(
      check([{ id: 'c', type: 'comment', z: 'tab1', x: 0, y: 0, name: 'a'.repeat(500) }] as never),
    ).toEqual([]);
  });
});
