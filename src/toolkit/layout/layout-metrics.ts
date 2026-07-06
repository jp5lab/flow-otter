import type { FlowsJson, FlowsJsonNode } from '../../shared/flows-json.js';
import {
  collectLayoutGeometry,
  type LayoutObject,
  rectHeight,
  rectWidth,
  type Rect,
} from '../lint/geometry.js';

export interface FlowMetricPosition {
  readonly x: number;
  readonly y: number;
}

export interface FlowMetricEdge {
  readonly sourceId: string;
  readonly sourcePort: number;
  readonly targetId: string;
}

export interface FlowMetricExtent {
  readonly w: number;
  readonly h: number;
}

export interface FlowMetrics {
  readonly nodes: number;
  readonly wires: number;
  readonly positions: ReadonlyMap<string, FlowMetricPosition>;
  readonly edges: readonly FlowMetricEdge[];
  readonly backwardWires: number;
  readonly wireCrossings: number;
  readonly straightLineCrossings: number;
  readonly extent: FlowMetricExtent;
}

export type FlowMetricRect = Rect;
export type FlowMetricObject = LayoutObject;

function zOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function positionOf(node: FlowsJsonNode): FlowMetricPosition | undefined {
  const record = node as { x?: unknown; y?: unknown };
  if (typeof record.x !== 'number' || typeof record.y !== 'number') return undefined;
  return { x: record.x, y: record.y };
}

function wireRowsOf(node: FlowsJsonNode): readonly (readonly string[])[] {
  const wires = (node as { wires?: unknown }).wires;
  if (!Array.isArray(wires)) return [];
  return wires
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.filter((target): target is string => typeof target === 'string'));
}

function cross(p: FlowMetricPosition, q: FlowMetricPosition, r: FlowMetricPosition): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

function strictSegmentsCross(
  p1: FlowMetricPosition,
  p2: FlowMetricPosition,
  p3: FlowMetricPosition,
  p4: FlowMetricPosition,
): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cloneWithoutGeometryFields(node: FlowsJsonNode): Record<string, unknown> {
  const clone = { ...node } as Record<string, unknown>;
  delete clone['x'];
  delete clone['y'];
  delete clone['w'];
  delete clone['h'];
  return clone;
}

export function flowPositions(
  flows: FlowsJson,
  tabId: string,
): ReadonlyMap<string, FlowMetricPosition> {
  const positions = new Map<string, FlowMetricPosition>();
  for (const node of flows) {
    if (zOf(node) !== tabId) continue;
    const position = positionOf(node);
    if (position !== undefined) positions.set(node.id, position);
  }
  return positions;
}

export function flowEdges(
  flows: FlowsJson,
  tabId: string,
  positions: ReadonlyMap<string, FlowMetricPosition> = flowPositions(flows, tabId),
): readonly FlowMetricEdge[] {
  const edges: FlowMetricEdge[] = [];
  for (const node of flows) {
    if (zOf(node) !== tabId || !positions.has(node.id)) continue;
    const rows = wireRowsOf(node);
    for (let sourcePort = 0; sourcePort < rows.length; sourcePort++) {
      for (const targetId of rows[sourcePort] ?? []) {
        if (positions.has(targetId)) edges.push({ sourceId: node.id, sourcePort, targetId });
      }
    }
  }
  return edges;
}

export function flowMetrics(flows: FlowsJson, tabId: string): FlowMetrics {
  const positions = flowPositions(flows, tabId);
  const edges = flowEdges(flows, tabId, positions);

  let backwardWires = 0;
  for (const edge of edges) {
    const source = positions.get(edge.sourceId);
    const target = positions.get(edge.targetId);
    if (source !== undefined && target !== undefined && target.x < source.x) backwardWires += 1;
  }

  let wireCrossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const first = edges[i]!;
      const second = edges[j]!;
      if (
        first.sourceId === second.sourceId ||
        first.sourceId === second.targetId ||
        first.targetId === second.sourceId ||
        first.targetId === second.targetId
      ) {
        continue;
      }
      const p1 = positions.get(first.sourceId);
      const p2 = positions.get(first.targetId);
      const p3 = positions.get(second.sourceId);
      const p4 = positions.get(second.targetId);
      if (
        p1 !== undefined &&
        p2 !== undefined &&
        p3 !== undefined &&
        p4 !== undefined &&
        strictSegmentsCross(p1, p2, p3, p4)
      ) {
        wireCrossings += 1;
      }
    }
  }

  const values = [...positions.values()];
  if (values.length === 0) {
    return {
      nodes: 0,
      wires: edges.length,
      positions,
      edges,
      backwardWires,
      wireCrossings,
      straightLineCrossings: wireCrossings,
      extent: { w: 0, h: 0 },
    };
  }

  const xs = values.map((position) => position.x);
  const ys = values.map((position) => position.y);
  return {
    nodes: positions.size,
    wires: edges.length,
    positions,
    edges,
    backwardWires,
    wireCrossings,
    straightLineCrossings: wireCrossings,
    extent: { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
  };
}

export function stripPositions(flows: FlowsJson): FlowsJson {
  return flows.map((node) => {
    if (node.type === 'group') return cloneWithoutGeometryFields(node) as FlowsJsonNode;

    const position = positionOf(node);
    if (position === undefined) return { ...node };
    return { ...node, x: 0, y: 0 };
  });
}

export function stripLayoutGeometry(flows: FlowsJson): readonly Record<string, unknown>[] {
  return flows.map((node) => cloneWithoutGeometryFields(node));
}

export function tabContentBounds(flows: FlowsJson, tabId: string): Rect | undefined {
  return collectLayoutGeometry(flows).tabs.get(tabId)?.contentBox;
}

export function tabLayoutObjects(
  flows: FlowsJson,
  tabId: string,
): ReadonlyMap<string, LayoutObject> {
  return collectLayoutGeometry(flows).tabs.get(tabId)?.objects ?? new Map<string, LayoutObject>();
}

export function layoutObjectBounds(flows: FlowsJson, tabId: string, id: string): Rect | undefined {
  return tabLayoutObjects(flows, tabId).get(id)?.box;
}

export function tabBoundingExtent(flows: FlowsJson, tabId: string): FlowMetricExtent {
  const bounds = tabContentBounds(flows, tabId);
  if (bounds === undefined) return { w: 0, h: 0 };
  return { w: rectWidth(bounds), h: rectHeight(bounds) };
}

export function horizontalOverlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2
  );
}

export function rectsDisjoint(a: Rect, b: Rect): boolean {
  return a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1;
}
