import { z } from 'zod';

import { LANE_GAP, LANE_ORDER, type Lane } from '../lanes.js';

import { DEFAULT_GRID, snapToGrid } from './grid.js';

export const SPATIAL_SCAFFOLD_GRID = DEFAULT_GRID;
export const SPATIAL_SCAFFOLD_PITCH = 200;
export const SPATIAL_SCAFFOLD_VIEWPORT = {
  width: 1920,
  visible_width: 1420,
} as const;

const LANE_BAND_HEIGHT = 120;
const LANE_ORIGIN_Y = 120;
const STAGE_ORIGIN_X = SPATIAL_SCAFFOLD_PITCH;

const LaneSchema = z.enum(LANE_ORDER);

export const SpatialLaneBandSchema = z.object({
  lane: LaneSchema,
  top: z.number().int(),
  center: z.number().int(),
  bottom: z.number().int(),
  height: z.number().int().positive(),
});

export const SpatialScaffoldStageSchema = z.object({
  name: z.string().min(1),
  estimated_nodes: z.number().int().positive(),
  lane: LaneSchema,
  columns: z.number().int().positive(),
  width: z.number().int().positive(),
  x_start: z.number().int(),
  x_center: z.number().int(),
  x_end: z.number().int(),
  y_center: z.number().int(),
});

export const SpatialScaffoldSchema = z.object({
  grid: z.literal(SPATIAL_SCAFFOLD_GRID),
  pitch: z.literal(SPATIAL_SCAFFOLD_PITCH),
  viewport: z.object({
    width: z.literal(SPATIAL_SCAFFOLD_VIEWPORT.width),
    visible_width: z.literal(SPATIAL_SCAFFOLD_VIEWPORT.visible_width),
  }),
  lane_bands: z.array(SpatialLaneBandSchema).length(LANE_ORDER.length),
  stages: z.array(SpatialScaffoldStageSchema),
});

export type SpatialLaneBand = z.infer<typeof SpatialLaneBandSchema>;
export type SpatialScaffoldStage = z.infer<typeof SpatialScaffoldStageSchema>;
export type SpatialScaffold = z.infer<typeof SpatialScaffoldSchema>;

export interface SpatialScaffoldStageInput {
  readonly name: string;
  readonly estimated_nodes: number;
  readonly lane?: Lane | undefined;
}

function snapNumber(value: number): number {
  return snapToGrid({ x: value, y: 0 }, SPATIAL_SCAFFOLD_GRID).x;
}

function buildLaneBands(): SpatialLaneBand[] {
  return LANE_ORDER.map((lane, index) => {
    const top = snapNumber(LANE_ORIGIN_Y + index * (LANE_BAND_HEIGHT + LANE_GAP));
    const bottom = snapNumber(top + LANE_BAND_HEIGHT);
    return {
      lane,
      top,
      center: snapNumber((top + bottom) / 2),
      bottom,
      height: bottom - top,
    };
  });
}

/**
 * Builds a deterministic sidecar scaffold for `plan_flow`.
 *
 * It does not move nodes or affect staging. The x-axis allocates one 200px
 * column per estimated node and reports each stage's center from cumulative
 * stage widths. The y-axis exposes ordered lane bands agents can use later
 * when assigning explicit positions.
 */
export function buildSpatialScaffold(
  stages: readonly SpatialScaffoldStageInput[],
): SpatialScaffold {
  const laneBands = buildLaneBands();
  const bandsByLane = new Map(laneBands.map((band) => [band.lane, band]));
  let cursor = STAGE_ORIGIN_X;

  return {
    grid: SPATIAL_SCAFFOLD_GRID,
    pitch: SPATIAL_SCAFFOLD_PITCH,
    viewport: SPATIAL_SCAFFOLD_VIEWPORT,
    lane_bands: laneBands,
    stages: stages.map((stage) => {
      const lane = stage.lane ?? 'main';
      const columns = stage.estimated_nodes;
      const width = snapNumber(columns * SPATIAL_SCAFFOLD_PITCH);
      const xStart = snapNumber(cursor);
      const xEnd = snapNumber(xStart + width);
      const xCenter = snapNumber((xStart + xEnd) / 2);
      cursor = xEnd;

      return {
        name: stage.name,
        estimated_nodes: stage.estimated_nodes,
        lane,
        columns,
        width,
        x_start: xStart,
        x_center: xCenter,
        x_end: xEnd,
        y_center: bandsByLane.get(lane)!.center,
      };
    }),
  };
}
