import { snapToGrid } from '../../layout/grid.js';
import { placeRightOf } from '../../layout/placement.js';
import type { Position, TabSpec } from '../types.js';

export function defaultSpawnPosition(tab: TabSpec): Position {
  if (tab.nodes.length === 0) return snapToGrid({ x: 80, y: 80 });
  let anchor: Position = tab.nodes[0]!.position;
  for (const n of tab.nodes) {
    if (n.position.x > anchor.x || (n.position.x === anchor.x && n.position.y > anchor.y)) {
      anchor = n.position;
    }
  }
  return placeRightOf(anchor);
}
