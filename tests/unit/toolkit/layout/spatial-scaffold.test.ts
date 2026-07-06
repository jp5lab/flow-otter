import { describe, expect, it } from 'vitest';

import { LANE_GAP, LANE_ORDER } from '../../../../src/toolkit/lanes.js';
import { buildSpatialScaffold } from '../../../../src/toolkit/layout/spatial-scaffold.js';

const stages = [
  { name: 'ingest', estimated_nodes: 2 },
  { name: 'display', estimated_nodes: 1, lane: 'indicate' as const },
  { name: 'recover', estimated_nodes: 3, lane: 'error' as const },
] as const;

describe('buildSpatialScaffold', () => {
  it('is deterministic for the same stage input', () => {
    expect(buildSpatialScaffold(stages)).toEqual(buildSpatialScaffold(stages));
  });

  it('pins the visible viewport and pitch constants', () => {
    const scaffold = buildSpatialScaffold(stages);

    expect(scaffold.grid).toBe(20);
    expect(scaffold.pitch).toBe(200);
    expect(scaffold.viewport).toEqual({ width: 1920, visible_width: 1420 });
  });

  it('builds ordered, grid-snapped lane bands with the error lane below main', () => {
    const scaffold = buildSpatialScaffold(stages);
    const bandsByLane = new Map(scaffold.lane_bands.map((band) => [band.lane, band]));

    expect(scaffold.lane_bands.map((band) => band.lane)).toEqual(LANE_ORDER);

    for (const band of scaffold.lane_bands) {
      expect(band.top % scaffold.grid).toBe(0);
      expect(band.bottom % scaffold.grid).toBe(0);
      expect(band.center % scaffold.grid).toBe(0);
      expect(band.bottom).toBeGreaterThan(band.top);
    }

    const main = bandsByLane.get('main');
    const indicate = bandsByLane.get('indicate');
    const error = bandsByLane.get('error');

    expect(main).toBeDefined();
    expect(indicate).toBeDefined();
    expect(error).toBeDefined();
    expect(indicate!.top).toBeGreaterThanOrEqual(main!.bottom + LANE_GAP);
    expect(error!.top).toBeGreaterThanOrEqual(indicate!.bottom + LANE_GAP);
    expect(error!.top).toBeGreaterThanOrEqual(main!.bottom + LANE_GAP);
  });

  it('assigns strictly increasing grid-snapped x centers from stage widths', () => {
    const scaffold = buildSpatialScaffold(stages);

    for (const stage of scaffold.stages) {
      expect(stage.x_center % scaffold.grid).toBe(0);
      expect(stage.width % scaffold.grid).toBe(0);
      expect(stage.x_start % scaffold.grid).toBe(0);
      expect(stage.x_end % scaffold.grid).toBe(0);
    }

    const centers = scaffold.stages.map((stage) => stage.x_center);
    expect(centers).toEqual([...centers].sort((a, b) => a - b));
    expect(new Set(centers).size).toBe(centers.length);
  });
});
