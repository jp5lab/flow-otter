import { describe, expect, it } from 'vitest';

import { LANE_GAP } from '../../../../src/toolkit/lanes.js';
import { stackVertical } from '../../../../src/toolkit/layout/stack.js';

describe('stackVertical', () => {
  it('stacks non-empty extents in order with the requested gap', () => {
    const [first, second] = stackVertical(
      [
        { key: 'main', rect: { x1: 0, y1: 20, x2: 200, y2: 80 } },
        { key: 'error', rect: { x1: 0, y1: 10, x2: 160, y2: 50 } },
      ],
      { gap: LANE_GAP },
    );

    expect(first?.dy).toBe(0);
    expect(second?.rect.y1).toBe((first?.rect.y2 ?? 0) + LANE_GAP);
  });

  it('does not introduce a phantom gap before the first present extent', () => {
    const [only] = stackVertical([{ key: 'error', rect: { x1: 0, y1: 10, x2: 160, y2: 50 } }], {
      gap: LANE_GAP,
    });

    expect(only?.dy).toBe(0);
    expect(only?.rect.y1).toBe(10);
  });
});
