import { describe, expect, it } from 'vitest';

import { placeRightOf } from '../../../../src/toolkit/layout/placement.js';

describe('placeRightOf', () => {
  it('places 70px right by default, grid-aligned', () => {
    expect(placeRightOf({ x: 100, y: 100 })).toEqual({ x: 180, y: 100 });
  });

  it('respects custom offset', () => {
    expect(placeRightOf({ x: 100, y: 100 }, { offset: 100 })).toEqual({ x: 200, y: 100 });
  });

  it('caps to bounds when overflowing', () => {
    const placed = placeRightOf(
      { x: 2390, y: 100 },
      { bounds: { xMin: 0, yMin: 0, xMax: 2400, yMax: 1600 } },
    );
    expect(placed.x).toBeLessThanOrEqual(2400);
  });
});
