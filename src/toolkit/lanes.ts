import {
  configByReferenceIds,
  hasCanvasPosition,
  isConfigShapedNode,
  isGroup,
  isJunction,
  isRegularNode,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
} from '../shared/flows-json.js';

import type { TabSpec } from './authoring/types.js';

export type Lane = 'main' | 'indicate' | 'error';

export const LANE_NAMES = ['main', 'indicate', 'error'] as const satisfies readonly Lane[];
export const LANE_ORDER = ['main', 'indicate', 'error'] as const satisfies readonly Lane[];
export const LANE_GAP = 120;

export interface LaneDerivation {
  readonly lanesById: ReadonlyMap<string, Lane>;
}

export interface TabLaneOptions {
  readonly laneHints?: ReadonlyMap<string, Lane>;
}

interface LaneGraphNode {
  readonly id: string;
  readonly type: string;
  readonly explicitLane?: Lane;
}

interface LaneGraph {
  readonly nodes: ReadonlyMap<string, LaneGraphNode>;
  readonly edges: readonly LaneEdge[];
}

interface MutableLaneGraph {
  readonly nodes: Map<string, LaneGraphNode>;
  readonly edges: LaneEdge[];
}

interface LaneEdge {
  readonly from: string;
  readonly to: string;
}

function emptyMutableGraph(): MutableLaneGraph {
  return { nodes: new Map(), edges: [] };
}

function validLane(value: unknown): Lane | undefined {
  return typeof value === 'string' && (LANE_NAMES as readonly string[]).includes(value)
    ? (value as Lane)
    : undefined;
}

function explicitLaneOf(value: unknown): Lane | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return validLane(record._authoringLane) ?? validLane(record.lane);
}

function isErrorSeed(node: LaneGraphNode): boolean {
  return node.explicitLane === 'error' || node.type === 'catch' || node.type === 'complete';
}

function isIndicateSeed(node: LaneGraphNode): boolean {
  return node.explicitLane === 'indicate' || node.type === 'status';
}

function outgoingEdges(edges: readonly LaneEdge[]): Map<string, string[]> {
  const bySource = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = bySource.get(edge.from);
    if (targets === undefined) bySource.set(edge.from, [edge.to]);
    else targets.push(edge.to);
  }
  return bySource;
}

function incomingCounts(
  nodes: ReadonlyMap<string, LaneGraphNode>,
  edges: readonly LaneEdge[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of nodes.keys()) counts.set(id, 0);
  for (const edge of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  }
  return counts;
}

function reachableFrom(
  edgesBySource: ReadonlyMap<string, readonly string[]>,
  starts: Iterable<string>,
): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const id of starts) {
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    const next = queue[i]!;
    for (const target of edgesBySource.get(next) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

function deriveGraphLanes(graph: LaneGraph): LaneDerivation {
  const edgesBySource = outgoingEdges(graph.edges);
  const indegree = incomingCounts(graph.nodes, graph.edges);
  const errorSeeds: string[] = [];
  const indicateSeeds: string[] = [];
  const mainRoots: string[] = [];

  for (const node of graph.nodes.values()) {
    if (isErrorSeed(node)) {
      errorSeeds.push(node.id);
      continue;
    }
    if (isIndicateSeed(node)) {
      indicateSeeds.push(node.id);
      continue;
    }
    if (node.explicitLane === 'main' || (indegree.get(node.id) ?? 0) === 0) {
      mainRoots.push(node.id);
    }
  }

  const reachableMain = reachableFrom(edgesBySource, mainRoots);
  const reachableError = reachableFrom(edgesBySource, errorSeeds);
  const reachableIndicate = reachableFrom(edgesBySource, indicateSeeds);
  const lanesById = new Map<string, Lane>();

  for (const node of graph.nodes.values()) {
    if (node.explicitLane !== undefined) {
      lanesById.set(node.id, node.explicitLane);
    } else if (node.type === 'catch' || node.type === 'complete') {
      lanesById.set(node.id, 'error');
    } else if (node.type === 'status') {
      lanesById.set(node.id, 'indicate');
    } else if (reachableMain.has(node.id)) {
      lanesById.set(node.id, 'main');
    } else if (reachableError.has(node.id)) {
      lanesById.set(node.id, 'error');
    } else if (reachableIndicate.has(node.id)) {
      lanesById.set(node.id, 'indicate');
    } else {
      lanesById.set(node.id, 'main');
    }
  }

  return { lanesById };
}

function zOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function rowsOf(node: FlowsJsonNode): readonly (readonly string[])[] {
  const wires = (node as { wires?: unknown }).wires;
  if (!Array.isArray(wires)) return [];
  return wires as readonly (readonly string[])[];
}

function graphForTab(graphs: Map<string, MutableLaneGraph>, tabId: string): MutableLaneGraph {
  const existing = graphs.get(tabId);
  if (existing !== undefined) return existing;
  const created = emptyMutableGraph();
  graphs.set(tabId, created);
  return created;
}

function addGraphNode(
  graph: MutableLaneGraph,
  id: string,
  type: string,
  explicitLane?: Lane,
): void {
  graph.nodes.set(id, {
    id,
    type,
    ...(explicitLane !== undefined ? { explicitLane } : {}),
  });
}

interface FlowGroupLaneIndexes {
  readonly byGroupIdByTab: ReadonlyMap<string, ReadonlyMap<string, Lane>>;
  readonly byMemberIdByTab: ReadonlyMap<string, ReadonlyMap<string, Lane>>;
}

function mutableTabLaneMap(map: Map<string, Map<string, Lane>>, tabId: string): Map<string, Lane> {
  const existing = map.get(tabId);
  if (existing !== undefined) return existing;
  const created = new Map<string, Lane>();
  map.set(tabId, created);
  return created;
}

function groupLaneIndexes(flows: FlowsJson): FlowGroupLaneIndexes {
  const byGroupIdByTab = new Map<string, Map<string, Lane>>();
  const byMemberIdByTab = new Map<string, Map<string, Lane>>();
  for (const node of flows) {
    if (!isGroup(node)) continue;
    const tabId = zOf(node);
    if (tabId === undefined) continue;
    const lane = explicitLaneOf(node);
    if (lane === undefined) continue;
    mutableTabLaneMap(byGroupIdByTab, tabId).set(node.id, lane);
    const tabMemberLanes = mutableTabLaneMap(byMemberIdByTab, tabId);
    for (const memberId of node.nodes) tabMemberLanes.set(memberId, lane);
  }
  return { byGroupIdByTab, byMemberIdByTab };
}

function groupLaneForNode(
  tabGroupLanes: ReadonlyMap<string, Lane> | undefined,
  tabMemberLanes: ReadonlyMap<string, Lane> | undefined,
  node: FlowsJsonNode,
): Lane | undefined {
  const groupId = (node as { g?: unknown }).g;
  if (typeof groupId === 'string') {
    const lane = tabGroupLanes?.get(groupId);
    if (lane !== undefined) return lane;
  }
  return tabMemberLanes?.get(node.id);
}

export function deriveFlowsJsonLanes(flows: FlowsJson): ReadonlyMap<string, LaneDerivation> {
  const graphs = new Map<string, MutableLaneGraph>();
  const configIds = configByReferenceIds(flows);
  const groupLanes = groupLaneIndexes(flows);

  for (const node of flows) {
    if (isTab(node)) {
      graphForTab(graphs, node.id);
      continue;
    }
    if (!hasCanvasPosition(node)) continue;
    const tabId = zOf(node);
    if (tabId === undefined) continue;
    if (isConfigShapedNode(node, configIds)) continue;
    if (!isRegularNode(node) && !isJunction(node)) continue;
    const graph = graphForTab(graphs, tabId);
    const explicitLane =
      explicitLaneOf(node) ??
      groupLaneForNode(
        groupLanes.byGroupIdByTab.get(tabId),
        groupLanes.byMemberIdByTab.get(tabId),
        node,
      );
    addGraphNode(graph, node.id, node.type, explicitLane);
  }

  for (const node of flows) {
    if (!hasCanvasPosition(node)) continue;
    const tabId = zOf(node);
    if (tabId === undefined) continue;
    const graph = graphs.get(tabId);
    if (graph === undefined || !graph.nodes.has(node.id)) continue;
    const rows = isJunction(node) ? rowsOf(node).slice(0, 1) : rowsOf(node);
    for (const row of rows) {
      for (const target of row) {
        if (graph.nodes.has(target)) graph.edges.push({ from: node.id, to: target });
      }
    }
  }

  const result = new Map<string, LaneDerivation>();
  for (const [tabId, graph] of graphs) {
    result.set(tabId, deriveGraphLanes(graph));
  }
  return result;
}

function tabSpecGroupLanes(
  tab: TabSpec,
  hints: ReadonlyMap<string, Lane> | undefined,
): Map<string, Lane> {
  const lanes = new Map<string, Lane>();
  for (const group of tab.groups) {
    const lane = hints?.get(group.key) ?? explicitLaneOf(group);
    if (lane !== undefined) lanes.set(group.key, lane);
  }
  return lanes;
}

export function deriveTabSpecLanes(tab: TabSpec, opts: TabLaneOptions = {}): LaneDerivation {
  const graph = emptyMutableGraph();
  const hints = opts.laneHints;
  const groupLanes = tabSpecGroupLanes(tab, hints);

  for (const node of tab.nodes) {
    const groupLane = node.groupKey !== undefined ? groupLanes.get(node.groupKey) : undefined;
    addGraphNode(
      graph,
      node.key,
      node.type,
      hints?.get(node.key) ?? explicitLaneOf(node) ?? groupLane,
    );
  }
  for (const junction of tab.junctions ?? []) {
    const groupLane =
      junction.groupKey !== undefined ? groupLanes.get(junction.groupKey) : undefined;
    addGraphNode(
      graph,
      junction.key,
      'junction',
      hints?.get(junction.key) ?? explicitLaneOf(junction) ?? groupLane,
    );
  }
  for (const connection of tab.connections) {
    if (graph.nodes.has(connection.fromKey) && graph.nodes.has(connection.toKey)) {
      graph.edges.push({ from: connection.fromKey, to: connection.toKey });
    }
  }

  return deriveGraphLanes(graph);
}
