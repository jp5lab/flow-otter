import type { Position } from '../authoring/types.js';

export interface Bounds {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export const defaultBounds: Bounds = {
  xMin: 0,
  yMin: 0,
  xMax: 2400,
  yMax: 1600,
};

export function inBounds(p: Position, bounds: Bounds = defaultBounds): boolean {
  return p.x >= bounds.xMin && p.x <= bounds.xMax && p.y >= bounds.yMin && p.y <= bounds.yMax;
}
