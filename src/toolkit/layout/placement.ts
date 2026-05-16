import type { Position } from '../authoring/types.js';

import { defaultBounds, inBounds, type Bounds } from './bounds.js';
import { DEFAULT_GRID, snapToGrid } from './grid.js';

export const DEFAULT_RIGHT_OFFSET = 70;

interface PlaceRightOfOpts {
  offset?: number;
  grid?: number;
  bounds?: Bounds;
}

/**
 * Places a new node a fixed offset to the right of an existing node, snapped
 * to the grid. If the resulting position falls outside the canvas bounds,
 * caps to the bounds (still grid-aligned).
 */
export function placeRightOf(source: Position, opts: PlaceRightOfOpts = {}): Position {
  const offset = opts.offset ?? DEFAULT_RIGHT_OFFSET;
  const grid = opts.grid ?? DEFAULT_GRID;
  const bounds = opts.bounds ?? defaultBounds;
  const raw = { x: source.x + offset, y: source.y };
  const snapped = snapToGrid(raw, grid);
  if (inBounds(snapped, bounds)) return snapped;
  return snapToGrid(
    {
      x: Math.min(Math.max(snapped.x, bounds.xMin), bounds.xMax),
      y: Math.min(Math.max(snapped.y, bounds.yMin), bounds.yMax),
    },
    grid,
  );
}
