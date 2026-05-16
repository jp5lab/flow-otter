import { describe, expect, it } from 'vitest';

import { isOnGrid, snapToGrid } from '../../../../src/toolkit/layout/grid.js';

describe('snapToGrid', () => {
  it('snaps to nearest 20px multiple by default', () => {
    expect(snapToGrid({ x: 103, y: 99 })).toEqual({ x: 100, y: 100 });
    expect(snapToGrid({ x: 110, y: 110 })).toEqual({ x: 120, y: 120 });
  });

  it('honors custom grid', () => {
    expect(snapToGrid({ x: 6, y: 11 }, 5)).toEqual({ x: 5, y: 10 });
  });

  it('isOnGrid returns true for aligned positions', () => {
    expect(isOnGrid({ x: 100, y: 200 })).toBe(true);
    expect(isOnGrid({ x: 105, y: 200 })).toBe(false);
  });
});
