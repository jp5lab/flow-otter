/**
 * elkjs-backed layout for FlowOtter. Used for flows with groups, multi-output
 * nodes, or ≥30 total nodes — where dagre starts producing crowded layouts.
 *
 * Determinism: `elk.randomSeed: 1` (not 0; seed 0 re-seeds from system time).
 * Combined with sorted input and pinned elkjs version, layouts are
 * byte-stable across runs.
 *
 * Bundle: this module imports `elkjs/lib/elk.bundled.js` which inlines the
 * algorithm. No worker file deployment needed. Node 22+ users hit elkjs
 * issue #377 (env-detection sees globalThis.self and tries to instantiate
 * a real Worker); we sidestep it by passing a FakeWorker factory.
 */

import elkPkg from 'elkjs/lib/elk.bundled.js';
import type {
  ELK as ELKType,
  ELKConstructorArguments,
  ElkExtendedEdge,
  ElkNode,
  ElkPort,
} from 'elkjs/lib/elk.bundled.js';

// elkjs ships as a UMD bundle. Under ESM TypeScript, the default-import
// type resolves to `typeof import(...)` (a namespace) rather than the
// constructable class the runtime actually provides. Re-cast through a
// typed constructor alias so callers get type-checked.
type ElkConstructor = new (args?: ELKConstructorArguments) => ELKType;
const ELK = elkPkg as unknown as ElkConstructor;

import {
  getInputPortCount,
  getOutputPortCount,
  type AuthoringSpec,
  type ConnectionSpec,
  type GroupSpec,
  type JunctionSpec,
  type NodeSpec,
  type TabSpec,
} from '../authoring/types.js';
import { editorGeometryProvider, type PortAnchor } from '../render/metrics.js';

import {
  applyPositions,
  dimensionsForJunction,
  dimensionsForNode,
  type LayoutDiagnosticHandler,
  type LayoutParticipantDimensions,
} from './apply-positions.js';
import { defaultBounds, type Bounds } from './bounds.js';
import { DEFAULT_GRID } from './grid.js';

export interface ElkLayoutOpts {
  rankdir?: 'LR' | 'TB';
  nodesep?: number;
  ranksep?: number;
  grid?: number;
  bounds?: Bounds;
  onDiagnostic?: LayoutDiagnosticHandler;
}

const DEFAULTS = {
  rankdir: 'LR' as const,
  nodesep: 40,
  ranksep: 80,
};

/**
 * Node-RED group chrome reserves roughly 26px above members for the label and
 * about 10px on the other sides. This is compound spacing only; node geometry
 * still flows exclusively through the GeometryProvider-backed helpers.
 */
const GROUP_COMPOUND_PADDING = {
  top: 26,
  left: 10,
  bottom: 10,
  right: 10,
} as const;
const GROUP_PADDING_OPTION = `[top=${GROUP_COMPOUND_PADDING.top},left=${GROUP_COMPOUND_PADDING.left},bottom=${GROUP_COMPOUND_PADDING.bottom},right=${GROUP_COMPOUND_PADDING.right}]`;

interface ResolvedOpts {
  rankdir: 'LR' | 'TB';
  nodesep: number;
  ranksep: number;
  grid: number;
  bounds: Bounds;
  onDiagnostic?: LayoutDiagnosticHandler;
}

// The bundled file (`elkjs/lib/elk.bundled.js`) inlines the algorithm and
// runs synchronously when no workerFactory is provided. On Node 22+/Bun
// where `globalThis.self` exists, elkjs#377 can bite — but only when ELK
// tries to use Web Worker. The bundled path doesn't, so we deliberately
// omit workerFactory here. If we ever switch to elk-api.js (worker-based),
// re-enable the FakeWorker shim above.
const elk = new ELK();

interface ParticipantRecord {
  readonly key: string;
  readonly elkId: string;
  readonly groupKey?: string;
  readonly dims: LayoutParticipantDimensions;
  readonly elkNode: ElkNode;
  readonly inputPortId?: string;
  readonly outputPortIds: ReadonlyMap<number, string>;
}

function elkDirection(rankdir: ResolvedOpts['rankdir']): 'RIGHT' | 'DOWN' {
  return rankdir === 'LR' ? 'RIGHT' : 'DOWN';
}

function nodeElkId(key: string): string {
  return `node:${key}`;
}

function junctionElkId(key: string): string {
  return `junction:${key}`;
}

function groupElkId(key: string): string {
  return `group:${key}`;
}

function inputPortId(elkId: string): string {
  return `${elkId}:in`;
}

function outputPortId(elkId: string, outputIndex: number): string {
  return `${elkId}:out:${outputIndex}`;
}

function sortedUniqueGroups(groups: readonly GroupSpec[]): GroupSpec[] {
  const seen = new Set<string>();
  const sortedGroups = [...groups].sort((a, b) => a.key.localeCompare(b.key));
  return sortedGroups.filter((group) => {
    if (seen.has(group.key)) return false;
    seen.add(group.key);
    return true;
  });
}

function parentChainCycles(
  groupKey: string,
  parentKey: string,
  groupByKey: ReadonlyMap<string, GroupSpec>,
): boolean {
  const seen = new Set<string>([groupKey]);
  let cursor: string | undefined = parentKey;
  while (cursor !== undefined) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const nextParent: string | undefined = groupByKey.get(cursor)?.parentKey;
    if (nextParent === undefined || !groupByKey.has(nextParent)) return false;
    cursor = nextParent;
  }
  return false;
}

function resolvedParentKey(
  group: GroupSpec,
  groupByKey: ReadonlyMap<string, GroupSpec>,
): string | undefined {
  if (group.parentKey === undefined) return undefined;
  if (!groupByKey.has(group.parentKey)) return undefined;
  if (parentChainCycles(group.key, group.parentKey, groupByKey)) return undefined;
  return group.parentKey;
}

function buildGroupCompounds(groups: readonly GroupSpec[]): {
  readonly rootGroups: ElkNode[];
  readonly groupNodesByKey: ReadonlyMap<string, ElkNode>;
  readonly groupKeys: ReadonlySet<string>;
} {
  const uniqueGroups = sortedUniqueGroups(groups);
  const groupByKey = new Map(uniqueGroups.map((group) => [group.key, group]));
  const groupNodesByKey = new Map<string, ElkNode>();

  for (const group of uniqueGroups) {
    groupNodesByKey.set(group.key, {
      id: groupElkId(group.key),
      layoutOptions: {
        'elk.padding': GROUP_PADDING_OPTION,
      },
      children: [],
    });
  }

  const rootGroups: ElkNode[] = [];
  for (const group of uniqueGroups) {
    const groupNode = groupNodesByKey.get(group.key)!;
    const parentKey = resolvedParentKey(group, groupByKey);
    const parentNode = parentKey === undefined ? undefined : groupNodesByKey.get(parentKey);
    if (parentNode === undefined) {
      rootGroups.push(groupNode);
    } else {
      parentNode.children ??= [];
      parentNode.children.push(groupNode);
    }
  }

  return { rootGroups, groupNodesByKey, groupKeys: new Set(groupNodesByKey.keys()) };
}

function sideForHorizontalAnchor(anchor: PortAnchor, width: number): 'WEST' | 'EAST' {
  return anchor.x <= width / 2 ? 'WEST' : 'EAST';
}

function port(id: string, side: 'WEST' | 'EAST'): ElkPort {
  return {
    id,
    layoutOptions: {
      'elk.port.side': side,
    },
  };
}

function buildNodeParticipant(node: NodeSpec): ParticipantRecord {
  const dims = dimensionsForNode(node);
  const elkId = nodeElkId(node.key);
  const inputCount = Math.max(0, getInputPortCount(node.type, node.passthrough));
  const outputCount = Math.max(0, getOutputPortCount(node.type, node.passthrough));
  const ports: ElkPort[] = [];
  const outputPortIds = new Map<number, string>();
  let inputId: string | undefined;

  if (inputCount > 0) {
    const anchor = editorGeometryProvider.inputPortAnchor(dims.h);
    inputId = inputPortId(elkId);
    ports.push(port(inputId, sideForHorizontalAnchor(anchor, dims.w)));
  }

  const orderedOutputAnchors = editorGeometryProvider
    .outputPortAnchors(dims.w, dims.h, outputCount)
    .map((anchor, index) => ({ anchor, index }))
    .sort((a, b) => a.anchor.y - b.anchor.y || a.index - b.index);
  for (const { anchor, index } of orderedOutputAnchors) {
    const outId = outputPortId(elkId, index);
    outputPortIds.set(index, outId);
    ports.push(port(outId, sideForHorizontalAnchor(anchor, dims.w)));
  }

  const elkNode: ElkNode = {
    id: elkId,
    width: dims.w,
    height: dims.h,
    layoutOptions: {
      'elk.portConstraints': 'FIXED_ORDER',
    },
    ...(ports.length > 0 ? { ports } : {}),
  };

  return {
    key: node.key,
    elkId,
    ...(node.groupKey !== undefined ? { groupKey: node.groupKey } : {}),
    dims,
    elkNode,
    ...(inputId !== undefined ? { inputPortId: inputId } : {}),
    outputPortIds,
  };
}

function buildJunctionParticipant(junction: JunctionSpec): ParticipantRecord {
  const dims = dimensionsForJunction();
  const elkId = junctionElkId(junction.key);
  const inputId = inputPortId(elkId);
  const outId = outputPortId(elkId, 0);
  const outputPortIds = new Map<number, string>([[0, outId]]);
  const elkNode: ElkNode = {
    id: elkId,
    width: dims.w,
    height: dims.h,
    layoutOptions: {
      'elk.portConstraints': 'FIXED_ORDER',
    },
    ports: [port(inputId, 'WEST'), port(outId, 'EAST')],
  };

  return {
    key: junction.key,
    elkId,
    ...(junction.groupKey !== undefined ? { groupKey: junction.groupKey } : {}),
    dims,
    elkNode,
    inputPortId: inputId,
    outputPortIds,
  };
}

function attachParticipant(
  participant: ParticipantRecord,
  rootChildren: ElkNode[],
  groupNodesByKey: ReadonlyMap<string, ElkNode>,
  groupKeys: ReadonlySet<string>,
): void {
  const groupNode =
    participant.groupKey !== undefined && groupKeys.has(participant.groupKey)
      ? groupNodesByKey.get(participant.groupKey)
      : undefined;

  if (groupNode === undefined) {
    rootChildren.push(participant.elkNode);
    return;
  }
  groupNode.children ??= [];
  groupNode.children.push(participant.elkNode);
}

function buildEdges(
  connections: readonly ConnectionSpec[],
  participantsByKey: ReadonlyMap<string, ParticipantRecord>,
): ElkExtendedEdge[] {
  const edges: ElkExtendedEdge[] = [];
  for (const connection of connections) {
    if (connection.fromKey === connection.toKey) continue;
    const source = participantsByKey.get(connection.fromKey);
    const target = participantsByKey.get(connection.toKey);
    if (source === undefined || target === undefined) continue;
    const sourcePortId = source.outputPortIds.get(connection.outputPort);
    const targetPortId = target.inputPortId;
    if (sourcePortId === undefined || targetPortId === undefined) continue;
    edges.push({
      id: `edge:${edges.length}:${connection.fromKey}:${connection.outputPort}:${connection.toKey}`,
      sources: [sourcePortId],
      targets: [targetPortId],
    });
  }
  return edges;
}

function collectCenters(
  node: ElkNode,
  parentOffset: { readonly x: number; readonly y: number },
  participantKeyByElkId: ReadonlyMap<string, string>,
  dimensionsByKey: ReadonlyMap<string, LayoutParticipantDimensions>,
  centerByKey: Map<string, { x: number; y: number }>,
): void {
  const x = parentOffset.x + (node.x ?? 0);
  const y = parentOffset.y + (node.y ?? 0);
  const key = participantKeyByElkId.get(node.id);
  if (key !== undefined && typeof node.x === 'number' && typeof node.y === 'number') {
    const dims = dimensionsByKey.get(key);
    if (dims !== undefined) {
      centerByKey.set(key, {
        x: x + dims.w / 2,
        y: y + dims.h / 2,
      });
    }
  }

  for (const child of node.children ?? []) {
    collectCenters(child, { x, y }, participantKeyByElkId, dimensionsByKey, centerByKey);
  }
}

function diagnosticMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function layoutTab(tab: TabSpec, opts: ResolvedOpts): Promise<TabSpec> {
  // Deterministic input ordering: sort nodes by key, edges by from/port/to.
  // ELK's `considerModelOrder.strategy: NODES_AND_EDGES` honors this when
  // it doesn't add crossings — making layouts stable across small edits.
  const sortedNodes = [...tab.nodes].sort((a, b) => a.key.localeCompare(b.key));
  const sortedJunctions = [...(tab.junctions ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  const sortedGroups = sortedUniqueGroups(tab.groups);
  const sortedConnections = [...tab.connections].sort((a, b) => {
    if (a.fromKey !== b.fromKey) return a.fromKey.localeCompare(b.fromKey);
    if (a.outputPort !== b.outputPort) return a.outputPort - b.outputPort;
    return a.toKey.localeCompare(b.toKey);
  });

  const dimensionsByKey = new Map<string, LayoutParticipantDimensions>();
  const participants: ParticipantRecord[] = [];
  const participantsByKey = new Map<string, ParticipantRecord>();
  const participantKeyByElkId = new Map<string, string>();
  for (const node of sortedNodes) {
    const participant = buildNodeParticipant(node);
    participants.push(participant);
    participantsByKey.set(node.key, participant);
    participantKeyByElkId.set(participant.elkId, node.key);
    dimensionsByKey.set(node.key, participant.dims);
  }
  for (const junction of sortedJunctions) {
    const participant = buildJunctionParticipant(junction);
    participants.push(participant);
    participantsByKey.set(junction.key, participant);
    participantKeyByElkId.set(participant.elkId, junction.key);
    dimensionsByKey.set(junction.key, participant.dims);
  }

  if (participants.length === 0) return tab;

  const { rootGroups, groupNodesByKey, groupKeys } = buildGroupCompounds(sortedGroups);
  const rootChildren = [...rootGroups];
  for (const participant of participants) {
    attachParticipant(participant, rootChildren, groupNodesByKey, groupKeys);
  }

  const graph: ElkNode = {
    id: tab.id,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': elkDirection(opts.rankdir),
      'elk.randomSeed': '1',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.spacing.nodeNode': String(opts.nodesep),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.ranksep),
    },
    children: rootChildren,
    edges: buildEdges(sortedConnections, participantsByKey),
  };

  let laid: ElkNode;
  try {
    laid = await elk.layout(graph);
  } catch (error) {
    opts.onDiagnostic?.({
      severity: 'warning',
      rule: 'layout/engine-error',
      tabId: tab.id,
      message: `ELK layout failed for tab '${tab.label}': ${diagnosticMessage(error)}`,
    });
    return tab;
  }

  const centerByKey = new Map<string, { x: number; y: number }>();
  for (const child of laid.children ?? []) {
    collectCenters(
      child,
      { x: laid.x ?? 0, y: laid.y ?? 0 },
      participantKeyByElkId,
      dimensionsByKey,
      centerByKey,
    );
  }

  return applyPositions(tab, centerByKey, dimensionsByKey, opts);
}

/**
 * ELK-backed layout. Same shape as layoutFlowsWithDagre but async (elkjs
 * is Promise-based even for in-process layout).
 */
export async function layoutFlowsWithElk(
  spec: AuthoringSpec,
  opts: ElkLayoutOpts = {},
): Promise<AuthoringSpec> {
  const resolved: ResolvedOpts = {
    rankdir: opts.rankdir ?? DEFAULTS.rankdir,
    nodesep: opts.nodesep ?? DEFAULTS.nodesep,
    ranksep: opts.ranksep ?? DEFAULTS.ranksep,
    grid: opts.grid ?? DEFAULT_GRID,
    bounds: opts.bounds ?? defaultBounds,
    ...(opts.onDiagnostic !== undefined ? { onDiagnostic: opts.onDiagnostic } : {}),
  };
  // Sort tabs for determinism, mirroring dagre.ts.
  const sortedTabs = [...spec.tabs].sort((a, b) => a.id.localeCompare(b.id));
  const newTabs: TabSpec[] = [];
  for (const tab of sortedTabs) newTabs.push(await layoutTab(tab, resolved));
  return { ...spec, tabs: newTabs };
}
