import { snapToGrid } from '../../layout/grid.js';
import { placeRightOf } from '../../layout/placement.js';
import type { Position, TabSpec } from '../types.js';

import {
  fallbackPlacementDimensions,
  nodePlacementDimensions,
  placementAreasForTab,
  type NodePlacementShape,
} from './_placement.js';

export function defaultSpawnPosition(tab: TabSpec, spawned?: NodePlacementShape): Position {
  if (tab.nodes.length === 0) return snapToGrid({ x: 80, y: 80 });
  let anchor = tab.nodes[0]!;
  for (const n of tab.nodes) {
    if (
      n.position.x > anchor.position.x ||
      (n.position.x === anchor.position.x && n.position.y > anchor.position.y)
    ) {
      anchor = n;
    }
  }
  const sourceDims = nodePlacementDimensions(anchor);
  const newDims =
    spawned === undefined ? fallbackPlacementDimensions() : nodePlacementDimensions(spawned);
  return placeRightOf(anchor.position, {
    sourceWidth: sourceDims.w,
    newWidth: newDims.w,
    newHeight: newDims.h,
    occupied: placementAreasForTab(tab),
  });
}
