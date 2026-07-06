import { describe, expect, it } from 'vitest';

import { placeOnLeftMarginNewRow, placeRightOf } from '../../../../src/toolkit/layout/placement.js';

describe('placeRightOf', () => {
  it('uses the 140px minimum step for very narrow nodes', () => {
    expect(placeRightOf({ x: 100, y: 100 }, { sourceWidth: 30, newWidth: 30 })).toEqual({
      x: 240,
      y: 100,
    });
  });

  it('uses provider widths plus gap and ceils the step to the grid', () => {
    expect(placeRightOf({ x: 100, y: 100 }, { sourceWidth: 100, newWidth: 130 })).toEqual({
      x: 280,
      y: 100,
    });
  });

  it('uses the taught 220px pitch when a 100px source feeds a 220px node', () => {
    expect(placeRightOf({ x: 100, y: 100 }, { sourceWidth: 100, newWidth: 220 })).toEqual({
      x: 320,
      y: 100,
    });
  });

  it('bumps down by deterministic 60px rows until the new bbox clears occupied content', () => {
    expect(
      placeRightOf(
        { x: 100, y: 100 },
        {
          sourceWidth: 100,
          newWidth: 100,
          occupied: [
            { position: { x: 260, y: 100 }, width: 100, height: 30 },
            { position: { x: 260, y: 160 }, width: 100, height: 30 },
          ],
        },
      ),
    ).toEqual({ x: 260, y: 220 });
  });
});

describe('placeOnLeftMarginNewRow', () => {
  it('starts an empty row on the left margin', () => {
    expect(placeOnLeftMarginNewRow([])).toEqual({ x: 120, y: 80 });
  });

  it('keeps the left margin at least 120px and places below content maxY plus 80px', () => {
    expect(
      placeOnLeftMarginNewRow([
        { position: { x: 80, y: 80 }, width: 100, height: 30 },
        { position: { x: 320, y: 200 }, width: 120, height: 60 },
      ]),
    ).toEqual({ x: 120, y: 320 });
  });

  it('reuses the existing left edge when it is already inside the margin', () => {
    expect(
      placeOnLeftMarginNewRow([{ position: { x: 180, y: 100 }, width: 100, height: 30 }]),
    ).toEqual({ x: 180, y: 200 });
  });
});
