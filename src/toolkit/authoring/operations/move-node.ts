import { snapToGrid } from '../../layout/grid.js';
import type { AuthoringSpec, NodeSpec, Position, TabSpec } from '../types.js';

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

  const node = sourceTab.nodes.find((n) => n.key === nodeKey);
  if (!node) {
    throw new MoveNodeError(`Node '${nodeKey}' not found on tab '${sourceTabId}'.`);
  }

  const targetPosition = snapToGrid(opts.position ?? node.position);
  const isCrossTab = opts.destTabId !== undefined && opts.destTabId !== sourceTabId;

  if (!isCrossTab) {
    const updatedNode: NodeSpec = { ...node, position: targetPosition };
    const updatedNodes = sourceTab.nodes.map((n) => (n.key === nodeKey ? updatedNode : n));
    const updatedTab: TabSpec = { ...sourceTab, nodes: updatedNodes };
    const updatedTabs = spec.tabs.map((t, i) => (i === sourceIndex ? updatedTab : t));
    return { spec: { ...spec, tabs: updatedTabs } };
  }

  const destTabId = opts.destTabId as string;
  const destIndex = spec.tabs.findIndex((t) => t.id === destTabId);
  if (destIndex < 0) {
    throw new MoveNodeError(`Destination tab '${destTabId}' not found in spec.`);
  }
  const destTab = spec.tabs[destIndex] as TabSpec;

  if (destTab.nodes.some((n) => n.key === nodeKey)) {
    throw new MoveNodeError(
      `Destination tab '${destTabId}' already contains a node with key '${nodeKey}'.`,
    );
  }

  const movedNode: NodeSpec = {
    key: node.key,
    type: node.type,
    position: targetPosition,
    ...(node.label !== undefined ? { label: node.label } : {}),
    ...(node.passthrough !== undefined ? { passthrough: node.passthrough } : {}),
  };

  const updatedSourceNodes = sourceTab.nodes.filter((n) => n.key !== nodeKey);
  const updatedSourceConnections = sourceTab.connections.filter(
    (c) => c.fromKey !== nodeKey && c.toKey !== nodeKey,
  );
  const scrubbedSourceGroups = sourceTab.groups.map((g) =>
    g.nodeKeys.includes(nodeKey) ? { ...g, nodeKeys: g.nodeKeys.filter((k) => k !== nodeKey) } : g,
  );
  const updatedSourceTab: TabSpec = {
    ...sourceTab,
    nodes: updatedSourceNodes,
    connections: updatedSourceConnections,
    groups: scrubbedSourceGroups,
  };

  const updatedDestTab: TabSpec = {
    ...destTab,
    nodes: [...destTab.nodes, movedNode],
  };

  const updatedTabs = spec.tabs.map((t, i) => {
    if (i === sourceIndex) return updatedSourceTab;
    if (i === destIndex) return updatedDestTab;
    return t;
  });

  return { spec: { ...spec, tabs: updatedTabs } };
}
