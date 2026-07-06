import type { Position } from '../authoring/types.js';

import { DEFAULT_GRID, snapToGrid } from './grid.js';

export const DEFAULT_RIGHT_GAP = 60;
export const DEFAULT_RIGHT_MIN_STEP = 140;
export const DEFAULT_COLLISION_Y_BUMP = 60;
export const DEFAULT_LEFT_MARGIN_X = 120;
export const DEFAULT_NEW_ROW_GAP = 80;
export const DEFAULT_EMPTY_ROW_Y = 80;
export const DEFAULT_PLACEMENT_HEIGHT = 30;

/** Back-compat alias for older callers that imported the constant. */
export const DEFAULT_RIGHT_OFFSET = DEFAULT_RIGHT_GAP;

export interface PlacementArea {
  readonly position: Position;
  readonly width: number;
  readonly height: number;
  readonly anchor?: 'center' | 'topLeft';
}

interface Rect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

interface PlaceRightOfOpts {
  readonly sourceWidth: number;
  readonly newWidth: number;
  readonly newHeight?: number;
  readonly gap?: number;
  readonly occupied?: readonly PlacementArea[];
  readonly grid?: number;
}

interface PlaceOnLeftMarginNewRowOpts {
  readonly minX?: number;
  readonly rowGap?: number;
  readonly emptyY?: number;
  readonly grid?: number;
}

function ceilToGrid(value: number, grid: number): number {
  return Math.ceil(value / grid) * grid;
}

function areaRect(area: PlacementArea): Rect {
  if (area.anchor === 'topLeft') {
    return {
      x1: area.position.x,
      y1: area.position.y,
      x2: area.position.x + area.width,
      y2: area.position.y + area.height,
    };
  }
  return centeredRect(area.position, area.width, area.height);
}

function centeredRect(center: Position, width: number, height: number): Rect {
  return {
    x1: center.x - width / 2,
    y1: center.y - height / 2,
    x2: center.x + width / 2,
    y2: center.y + height / 2,
  };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  if (a.x2 <= b.x1 || b.x2 <= a.x1) return false;
  if (a.y2 <= b.y1 || b.y2 <= a.y1) return false;
  return true;
}

function collides(
  candidate: Position,
  width: number,
  height: number,
  occupied: readonly PlacementArea[],
) {
  const box = centeredRect(candidate, width, height);
  return occupied.some((area) => rectsOverlap(box, areaRect(area)));
}

/**
 * Places a new node to the right of an existing node using editor-derived
 * widths. If the candidate box is occupied, it moves down in deterministic
 * 60px rows until clear.
 */
export function placeRightOf(source: Position, opts: PlaceRightOfOpts): Position {
  const grid = opts.grid ?? DEFAULT_GRID;
  const step = Math.max(
    DEFAULT_RIGHT_MIN_STEP,
    ceilToGrid(opts.sourceWidth / 2 + (opts.gap ?? DEFAULT_RIGHT_GAP) + opts.newWidth / 2, grid),
  );
  const occupied = opts.occupied ?? [];
  const newHeight = opts.newHeight ?? DEFAULT_PLACEMENT_HEIGHT;
  let candidate = snapToGrid({ x: source.x + step, y: source.y }, grid);
  while (collides(candidate, opts.newWidth, newHeight, occupied)) {
    candidate = snapToGrid({ x: candidate.x, y: candidate.y + DEFAULT_COLLISION_Y_BUMP }, grid);
  }
  return candidate;
}

export function placeOnLeftMarginNewRow(
  occupied: readonly PlacementArea[],
  opts: PlaceOnLeftMarginNewRowOpts = {},
): Position {
  const grid = opts.grid ?? DEFAULT_GRID;
  const minX = opts.minX ?? DEFAULT_LEFT_MARGIN_X;
  const rowGap = opts.rowGap ?? DEFAULT_NEW_ROW_GAP;
  if (occupied.length === 0)
    return snapToGrid({ x: minX, y: opts.emptyY ?? DEFAULT_EMPTY_ROW_Y }, grid);

  const minExistingX = Math.min(...occupied.map((area) => area.position.x));
  const contentMaxY = Math.max(...occupied.map((area) => areaRect(area).y2));
  return snapToGrid({ x: Math.max(minExistingX, minX), y: contentMaxY + rowGap }, grid);
}
