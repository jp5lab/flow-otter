import { snapToGrid } from '../../layout/grid.js';
import type {
  AuthoringSpec,
  CommentSpec,
  JunctionSpec,
  NodeSpec,
  Position,
  TabSpec,
} from '../types.js';

import {
  findCanvasObject,
  hasCanvasObject,
  scrubMemberFromGroups,
  withGroupKey,
  type CanvasObject,
} from './_membership.js';

export interface MoveNodeOpts {
  /** New position. If omitted, keeps the node's existing position. */
  position?: Position;
  /** Destination tab id. If omitted (or equal to source), repositions in place. */
  destTabId?: string;
}

export interface MoveNodeResult {
  spec: AuthoringSpec;
}

class MoveNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoveNodeError';
  }
}

export function moveNode(
  spec: AuthoringSpec,
  sourceTabId: string,
  nodeKey: string,
  opts: MoveNodeOpts = {},
): MoveNodeResult {
  const sourceIndex = spec.tabs.findIndex((t) => t.id === sourceTabId);
  if (sourceIndex < 0) {
    throw new MoveNodeError(`Source tab '${sourceTabId}' not found in spec.`);
  }
  const sourceTab = spec.tabs[sourceIndex] as TabSpec;

  const target = findCanvasObject(sourceTab, nodeKey);
  if (target === undefined) {
    throw new MoveNodeError(
      `Node, junction, or comment '${nodeKey}' not found on tab '${sourceTabId}'.`,
    );
  }

  const targetPosition = snapToGrid(opts.position ?? target.value.position);
  const isCrossTab = opts.destTabId !== undefined && opts.destTabId !== sourceTabId;

  if (!isCrossTab) {
    const updatedTab = replaceObjectPosition(sourceTab, target.kind, nodeKey, targetPosition);
    const updatedTabs = spec.tabs.map((t, i) => (i === sourceIndex ? updatedTab : t));
    return { spec: { ...spec, tabs: updatedTabs } };
  }

  const destTabId = opts.destTabId as string;
  const destIndex = spec.tabs.findIndex((t) => t.id === destTabId);
  if (destIndex < 0) {
    throw new MoveNodeError(`Destination tab '${destTabId}' not found in spec.`);
  }
  const destTab = spec.tabs[destIndex] as TabSpec;

  if (hasCanvasObject(destTab, nodeKey)) {
    throw new MoveNodeError(
      `Destination tab '${destTabId}' already contains a node, junction, or comment with key '${nodeKey}'.`,
    );
  }

  const movedObject = movedWithoutGroup(target, targetPosition);
  const updatedSourceNodes =
    target.kind === 'node' ? sourceTab.nodes.filter((n) => n.key !== nodeKey) : sourceTab.nodes;
  const updatedSourceJunctions =
    target.kind === 'junction'
      ? (sourceTab.junctions ?? []).filter((j) => j.key !== nodeKey)
      : sourceTab.junctions;
  const updatedSourceComments =
    target.kind === 'comment'
      ? sourceTab.comments.filter((c) => c.key !== nodeKey)
      : sourceTab.comments;
  const updatedSourceConnections = sourceTab.connections.filter(
    (c) => c.fromKey !== nodeKey && c.toKey !== nodeKey,
  );
  const scrubbedSourceGroups = scrubMemberFromGroups(sourceTab.groups, nodeKey);
  const updatedSourceTab: TabSpec = {
    ...sourceTab,
    nodes: updatedSourceNodes,
    ...(updatedSourceJunctions !== undefined ? { junctions: updatedSourceJunctions } : {}),
    comments: updatedSourceComments,
    connections: updatedSourceConnections,
    groups: scrubbedSourceGroups,
  };

  const updatedDestTab = appendMovedObject(destTab, target.kind, movedObject);

  const updatedTabs = spec.tabs.map((t, i) => {
    if (i === sourceIndex) return updatedSourceTab;
    if (i === destIndex) return updatedDestTab;
    return t;
  });

  return { spec: { ...spec, tabs: updatedTabs } };
}

function replaceObjectPosition(
  tab: TabSpec,
  kind: 'node' | 'junction' | 'comment',
  key: string,
  position: Position,
): TabSpec {
  if (kind === 'node') {
    return { ...tab, nodes: tab.nodes.map((n) => (n.key === key ? { ...n, position } : n)) };
  }
  if (kind === 'junction') {
    const junctions = (tab.junctions ?? []).map((j) => (j.key === key ? { ...j, position } : j));
    return { ...tab, junctions };
  }
  return { ...tab, comments: tab.comments.map((c) => (c.key === key ? { ...c, position } : c)) };
}

function movedWithoutGroup(
  target: CanvasObject,
  position: Position,
): NodeSpec | JunctionSpec | CommentSpec {
  return withGroupKey({ ...target.value, position }, undefined);
}

function appendMovedObject(
  tab: TabSpec,
  kind: 'node' | 'junction' | 'comment',
  object: NodeSpec | JunctionSpec | CommentSpec,
): TabSpec {
  if (kind === 'node') {
    return { ...tab, nodes: [...tab.nodes, object as NodeSpec] };
  }
  if (kind === 'junction') {
    return { ...tab, junctions: [...(tab.junctions ?? []), object] };
  }
  return { ...tab, comments: [...tab.comments, object as CommentSpec] };
}
