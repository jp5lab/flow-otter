import type { Position } from '../authoring/types.js';

export const DEFAULT_GRID = 20;

/**
 * Snaps a position to the nearest grid intersection. Defaults to 20px (Node-RED's
 * editor grid). Always returns integers.
 */
export function snapToGrid(p: Position, grid: number = DEFAULT_GRID): Position {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

export function isOnGrid(p: Position, grid: number = DEFAULT_GRID): boolean {
  return p.x % grid === 0 && p.y % grid === 0;
}
