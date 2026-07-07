import type { FlowsJson } from '../../shared/flows-json.js';

import { collectLayoutGeometry, rectWithin, type Point, type Rect } from './geometry.js';

export const DEFAULT_NODE_RED_CANVAS_BOUNDS: Rect = Object.freeze({
  x1: 0,
  y1: 0,
  x2: 2400,
  y2: 1600,
});

export interface CommentPileOffender {
  readonly id: string;
  readonly tabId: string;
  readonly center: Point;
  readonly pileSize: number;
}

export interface OffCanvasGroupOffender {
  readonly id: string;
  readonly tabId: string;
  readonly box: Rect;
  readonly bounds: Rect;
}

function centerKey(tabId: string, center: Point): string {
  return `${tabId}\u0000${center.x}\u0000${center.y}`;
}

export function commentPileOffenders(flows: FlowsJson): readonly CommentPileOffender[] {
  const comments = [...collectLayoutGeometry(flows).objects.values()].filter(
    (object) => object.kind === 'comment',
  );
  const pileSizes = new Map<string, number>();
  for (const comment of comments) {
    const key = centerKey(comment.tabId, comment.center);
    pileSizes.set(key, (pileSizes.get(key) ?? 0) + 1);
  }

  return comments
    .map((comment): CommentPileOffender | undefined => {
      const pileSize = pileSizes.get(centerKey(comment.tabId, comment.center)) ?? 0;
      if (pileSize < 2) return undefined;
      return {
        id: comment.id,
        tabId: comment.tabId,
        center: comment.center,
        pileSize,
      };
    })
    .filter((offender): offender is CommentPileOffender => offender !== undefined);
}

export function offCanvasGroupOffenders(
  flows: FlowsJson,
  bounds: Rect = DEFAULT_NODE_RED_CANVAS_BOUNDS,
): readonly OffCanvasGroupOffender[] {
  return [...collectLayoutGeometry(flows).objects.values()]
    .filter((object) => object.kind === 'group' && !rectWithin(object.box, bounds))
    .map((group) => ({
      id: group.id,
      tabId: group.tabId,
      box: group.box,
      bounds,
    }));
}
