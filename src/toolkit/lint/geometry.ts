import {
  configByReferenceIds,
  hasCanvasPosition,
  isComment,
  isConfigShapedNode,
  isGroup,
  isJunction,
  isRegularNode,
  isSubflowDef,
  isSubflowInstance,
  isTab,
  SUBFLOW_INSTANCE_PREFIX,
  type FlowsJson,
  type FlowsJsonNode,
  type SubflowDefNode,
} from '../../shared/flows-json.js';
import { getInputPortCount, getOutputPortCount, isNodeLabelHidden } from '../authoring/types.js';
import { editorGeometryProvider, type GeometryProvider } from '../render/metrics.js';

const DEFAULT_GROUP_WIDTH = 200;
const DEFAULT_GROUP_HEIGHT = 100;
const JUNCTION_SIZE = 10;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export type LayoutObjectKind = 'node' | 'junction' | 'group' | 'comment';

export interface LayoutObject {
  readonly id: string;
  readonly tabId: string;
  readonly kind: LayoutObjectKind;
  readonly parentGroupId?: string;
  readonly center: Point;
  readonly box: Rect;
  readonly inputPort?: Point;
  readonly outputPorts: readonly Point[];
}

export interface LayoutWireEndpoint extends Point {
  readonly nodeId: string;
  readonly port: number;
}

export interface LayoutWire {
  readonly id: string;
  readonly tabId: string;
  readonly sourceId: string;
  readonly sourcePort: number;
  readonly targetId: string;
  readonly from: LayoutWireEndpoint;
  readonly to: LayoutWireEndpoint;
}

export interface LayoutTabGeometry {
  readonly tabId: string;
  readonly objects: ReadonlyMap<string, LayoutObject>;
  readonly groups: readonly LayoutObject[];
  readonly wires: readonly LayoutWire[];
  readonly contentBox?: Rect;
}

export interface LayoutGeometry {
  readonly tabs: ReadonlyMap<string, LayoutTabGeometry>;
  readonly objects: ReadonlyMap<string, LayoutObject>;
}

export interface CollectLayoutGeometryOptions {
  readonly geometryProvider?: GeometryProvider;
}

interface MutableTabGeometry {
  readonly tabId: string;
  readonly objects: Map<string, LayoutObject>;
  readonly groups: LayoutObject[];
  readonly wires: LayoutWire[];
  contentBox?: Rect;
}

function zOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function nameOf(node: FlowsJsonNode): string {
  const name = (node as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

export function wiresOf(node: FlowsJsonNode): string[][] {
  const wires = (node as { wires?: unknown }).wires;
  if (!Array.isArray(wires)) return [];
  return wires as string[][];
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  if (a.x2 <= b.x1 || b.x2 <= a.x1) return false;
  if (a.y2 <= b.y1 || b.y2 <= a.y1) return false;
  return true;
}

export function rectWithin(rect: Rect, bounds: Rect): boolean {
  return (
    rect.x1 >= bounds.x1 && rect.y1 >= bounds.y1 && rect.x2 <= bounds.x2 && rect.y2 <= bounds.y2
  );
}

export function rectWidth(rect: Rect): number {
  return rect.x2 - rect.x1;
}

export function rectHeight(rect: Rect): number {
  return rect.y2 - rect.y1;
}

export function centeredRect(center: Point, w: number, h: number): Rect {
  return {
    x1: center.x - w / 2,
    y1: center.y - h / 2,
    x2: center.x + w / 2,
    y2: center.y + h / 2,
  };
}

export function unionRect(a: Rect | undefined, b: Rect): Rect {
  if (a === undefined) return b;
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

function tabFor(map: Map<string, MutableTabGeometry>, tabId: string): MutableTabGeometry {
  const existing = map.get(tabId);
  if (existing) return existing;
  const created: MutableTabGeometry = {
    tabId,
    objects: new Map<string, LayoutObject>(),
    groups: [],
    wires: [],
  };
  map.set(tabId, created);
  return created;
}

function regularNodeObject(
  node: FlowsJsonNode & { x: number; y: number },
  tabId: string,
  provider: GeometryProvider,
  subflowDefs: ReadonlyMap<string, SubflowDefNode>,
): LayoutObject | undefined {
  if (!isRegularNode(node)) return undefined;

  const rec = node as Record<string, unknown>;
  let inputs: number;
  let outputs: number;
  if (isSubflowInstance(node)) {
    const def = subflowDefs.get(node.type.slice(SUBFLOW_INSTANCE_PREFIX.length));
    inputs = def?.in?.length ?? 1;
    outputs = def?.out?.length ?? 1;
  } else {
    inputs = getInputPortCount(node.type, rec);
    outputs = getOutputPortCount(node.type, rec);
  }
  outputs = Math.max(outputs, wiresOf(node).length);

  const rawName = nameOf(node);
  const label = rawName !== '' ? rawName : node.type;
  const dims = provider.nodeDimensionsFor(label, {
    inputs,
    outputs,
    hideLabel: isNodeLabelHidden(node.type, rec),
  });
  const box = centeredRect({ x: node.x, y: node.y }, dims.w, dims.h);
  const outPorts = provider.outputPortAnchors(dims.w, dims.h, outputs).map((p) => ({
    x: box.x1 + p.x,
    y: box.y1 + p.y,
  }));
  const inputAnchor = inputs > 0 ? provider.inputPortAnchor(dims.h) : undefined;
  const inputPort =
    inputAnchor !== undefined
      ? { x: box.x1 + inputAnchor.x, y: box.y1 + inputAnchor.y }
      : undefined;

  return {
    id: node.id,
    tabId,
    kind: 'node',
    ...(typeof node.g === 'string' ? { parentGroupId: node.g } : {}),
    center: { x: node.x, y: node.y },
    box,
    ...(inputPort !== undefined ? { inputPort } : {}),
    outputPorts: outPorts,
  };
}

function objectForNode(
  node: FlowsJsonNode & { x: number; y: number },
  tabId: string,
  provider: GeometryProvider,
  subflowDefs: ReadonlyMap<string, SubflowDefNode>,
): LayoutObject | undefined {
  if (isGroup(node)) {
    const w = typeof node.w === 'number' ? node.w : DEFAULT_GROUP_WIDTH;
    const h = typeof node.h === 'number' ? node.h : DEFAULT_GROUP_HEIGHT;
    const box = { x1: node.x, y1: node.y, x2: node.x + w, y2: node.y + h };
    return {
      id: node.id,
      tabId,
      kind: 'group',
      ...(typeof node.g === 'string' ? { parentGroupId: node.g } : {}),
      center: { x: node.x + w / 2, y: node.y + h / 2 },
      box,
      outputPorts: [],
    };
  }

  if (isComment(node)) {
    const rawName = nameOf(node);
    const measured = provider.nodeDimensionsFor(rawName, { inputs: 0, outputs: 0 });
    const w = typeof node.w === 'number' ? node.w : measured.w;
    const h = typeof node.h === 'number' ? node.h : measured.h;
    return {
      id: node.id,
      tabId,
      kind: 'comment',
      ...(typeof node.g === 'string' ? { parentGroupId: node.g } : {}),
      center: { x: node.x, y: node.y },
      box: centeredRect({ x: node.x, y: node.y }, w, h),
      outputPorts: [],
    };
  }

  if (isJunction(node)) {
    const point = { x: node.x, y: node.y };
    return {
      id: node.id,
      tabId,
      kind: 'junction',
      ...(typeof node.g === 'string' ? { parentGroupId: node.g } : {}),
      center: point,
      box: centeredRect(point, JUNCTION_SIZE, JUNCTION_SIZE),
      inputPort: point,
      outputPorts: [point],
    };
  }

  return regularNodeObject(node, tabId, provider, subflowDefs);
}

export function collectLayoutGeometry(
  flows: FlowsJson,
  opts: CollectLayoutGeometryOptions = {},
): LayoutGeometry {
  const provider = opts.geometryProvider ?? editorGeometryProvider;
  const subflowDefs = new Map<string, SubflowDefNode>();
  for (const node of flows) {
    if (isSubflowDef(node)) subflowDefs.set(node.id, node);
  }

  const configIds = configByReferenceIds(flows);
  const tabs = new Map<string, MutableTabGeometry>();
  const objects = new Map<string, LayoutObject>();

  for (const node of flows) {
    if (isTab(node)) {
      tabFor(tabs, node.id);
      continue;
    }
    if (!hasCanvasPosition(node)) continue;
    const tabId = zOf(node);
    if (tabId === undefined) continue;
    if (isConfigShapedNode(node, configIds)) continue;

    const object = objectForNode(node, tabId, provider, subflowDefs);
    if (object === undefined) continue;
    const tab = tabFor(tabs, tabId);
    tab.objects.set(object.id, object);
    objects.set(object.id, object);
    if (object.kind === 'group') tab.groups.push(object);
    tab.contentBox = unionRect(tab.contentBox, object.box);
  }

  for (const node of flows) {
    if (!hasCanvasPosition(node)) continue;
    const tabId = zOf(node);
    if (tabId === undefined) continue;
    const tab = tabs.get(tabId);
    if (tab === undefined) continue;
    const source = tab.objects.get(node.id);
    if (source === undefined) continue;
    if (source.kind !== 'node' && source.kind !== 'junction') continue;

    const rows = source.kind === 'junction' ? wiresOf(node).slice(0, 1) : wiresOf(node);
    for (let port = 0; port < rows.length; port++) {
      const fromPoint = source.outputPorts[port];
      if (fromPoint === undefined) continue;
      for (const targetId of rows[port] ?? []) {
        const target = tab.objects.get(targetId);
        if (target?.inputPort === undefined) continue;
        tab.wires.push({
          id: `${node.id}:${port}:${targetId}:${tab.wires.length}`,
          tabId,
          sourceId: node.id,
          sourcePort: port,
          targetId,
          from: { nodeId: node.id, port, x: fromPoint.x, y: fromPoint.y },
          to: { nodeId: targetId, port: 0, x: target.inputPort.x, y: target.inputPort.y },
        });
      }
    }
  }

  return {
    tabs,
    objects,
  };
}
