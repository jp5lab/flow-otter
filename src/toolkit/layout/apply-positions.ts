import type { Diagnostic } from '../validate/report.js';
import {
  getInputPortCount,
  getOutputPortCount,
  isNodeLabelHidden,
  type NodeSpec,
  type Position,
  type TabSpec,
} from '../authoring/types.js';
import { editorGeometryProvider, type NodeDimensions } from '../render/metrics.js';

import type { Bounds } from './bounds.js';
import { snapToGrid } from './grid.js';

export type LayoutDiagnostic = Diagnostic;
export type LayoutDiagnosticHandler = (diagnostic: LayoutDiagnostic) => void;

export const JUNCTION_LAYOUT_SIZE = 10;

export interface LayoutParticipantDimensions {
  readonly w: number;
  readonly h: number;
}

interface ApplyPositionsOptions {
  readonly bounds: Bounds;
  readonly grid: number;
  readonly onDiagnostic?: LayoutDiagnosticHandler;
}

interface Rect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function labelFor(node: NodeSpec): string {
  return node.label ?? node.type;
}

export function dimensionsForNode(node: NodeSpec): NodeDimensions {
  const passthrough = node.passthrough;
  return editorGeometryProvider.nodeDimensionsFor(labelFor(node), {
    inputs: getInputPortCount(node.type, passthrough),
    outputs: getOutputPortCount(node.type, passthrough),
    hideLabel: isNodeLabelHidden(node.type, passthrough),
  });
}

export function dimensionsForJunction(): LayoutParticipantDimensions {
  return { w: JUNCTION_LAYOUT_SIZE, h: JUNCTION_LAYOUT_SIZE };
}

function unionRect(a: Rect | undefined, b: Rect): Rect {
  if (a === undefined) return b;
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

function centeredRect(center: Position, dims: LayoutParticipantDimensions): Rect {
  return {
    x1: center.x - dims.w / 2,
    y1: center.y - dims.h / 2,
    x2: center.x + dims.w / 2,
    y2: center.y + dims.h / 2,
  };
}

function emitWidthOverflow(
  tab: TabSpec,
  rect: Rect,
  bounds: Bounds,
  onDiagnostic: LayoutDiagnosticHandler | undefined,
): void {
  if (onDiagnostic === undefined) return;
  const width = rect.x2 - rect.x1;
  const boundsWidth = bounds.xMax - bounds.xMin;
  if (width <= boundsWidth) return;
  onDiagnostic({
    severity: 'warning',
    rule: 'layout/width-overflow',
    tabId: tab.id,
    message: `Layout for tab '${tab.label}' is ${Math.round(width)}px wide, exceeding the ${boundsWidth}px layout bounds.`,
    context: {
      width,
      boundsWidth,
      overflowPx: width - boundsWidth,
    },
  });
}

function translateDelta(min: number, max: number, minBound: number, maxBound: number): number {
  const span = max - min;
  const boundSpan = maxBound - minBound;
  if (span > boundSpan) return min < minBound ? minBound - min : 0;
  if (min < minBound) return minBound - min;
  if (max > maxBound) return maxBound - max;
  return 0;
}

export function applyPositions(
  tab: TabSpec,
  centerByKey: ReadonlyMap<string, Position>,
  dimensionsByKey: ReadonlyMap<string, LayoutParticipantDimensions>,
  opts: ApplyPositionsOptions,
): TabSpec {
  const snappedByKey = new Map<string, Position>();
  let minCenterX = Number.POSITIVE_INFINITY;
  let minCenterY = Number.POSITIVE_INFINITY;
  let maxCenterX = Number.NEGATIVE_INFINITY;
  let maxCenterY = Number.NEGATIVE_INFINITY;
  let contentRect: Rect | undefined;

  for (const [key, center] of centerByKey) {
    const dims = dimensionsByKey.get(key);
    if (dims === undefined) continue;
    const snapped = snapToGrid(center, opts.grid);
    snappedByKey.set(key, snapped);
    minCenterX = Math.min(minCenterX, snapped.x);
    minCenterY = Math.min(minCenterY, snapped.y);
    maxCenterX = Math.max(maxCenterX, snapped.x);
    maxCenterY = Math.max(maxCenterY, snapped.y);
    contentRect = unionRect(contentRect, centeredRect(snapped, dims));
  }

  if (snappedByKey.size === 0 || contentRect === undefined) return tab;

  emitWidthOverflow(tab, contentRect, opts.bounds, opts.onDiagnostic);

  const dx = translateDelta(minCenterX, maxCenterX, opts.bounds.xMin, opts.bounds.xMax);
  const dy = translateDelta(minCenterY, maxCenterY, opts.bounds.yMin, opts.bounds.yMax);
  const translatedByKey = new Map<string, Position>();
  for (const [key, position] of snappedByKey) {
    translatedByKey.set(key, snapToGrid({ x: position.x + dx, y: position.y + dy }, opts.grid));
  }

  const nodes = tab.nodes.map((node) => {
    const position = translatedByKey.get(node.key);
    return position === undefined ? node : { ...node, position };
  });
  const junctions = tab.junctions?.map((junction) => {
    const position = translatedByKey.get(junction.key);
    return position === undefined ? junction : { ...junction, position };
  });

  return {
    ...tab,
    nodes,
    ...(junctions !== undefined ? { junctions } : {}),
  };
}
