import type { AuthoringSpec, NodeSpec, Position, TabSpec } from '../types.js';

export interface UpdateNodeOpts {
  label?: string;
  position?: Position;
  /** `null` clears the group membership; `undefined` leaves it as-is. */
  groupKey?: string | null;
  /** Replaces the existing passthrough wholesale (no merge). */
  passthrough?: Readonly<Record<string, unknown>>;
}

export interface UpdateNodeResult {
  spec: AuthoringSpec;
  updated: boolean;
}

class UpdateNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateNodeError';
  }
}

export function updateNode(
  spec: AuthoringSpec,
  tabId: string,
  nodeKey: string,
  opts: UpdateNodeOpts,
): UpdateNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new UpdateNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const nodeIndex = tab.nodes.findIndex((n) => n.key === nodeKey);
  if (nodeIndex < 0) {
    return { spec, updated: false };
  }
  const existing = tab.nodes[nodeIndex] as NodeSpec;

  const nextLabel = opts.label !== undefined ? opts.label : existing.label;
  const nextPosition = opts.position ?? existing.position;
  const nextPassthrough = opts.passthrough !== undefined ? opts.passthrough : existing.passthrough;

  let nextGroupKey: string | undefined;
  if (opts.groupKey === undefined) {
    nextGroupKey = existing.groupKey;
  } else if (opts.groupKey === null) {
    nextGroupKey = undefined;
  } else {
    nextGroupKey = opts.groupKey;
  }

  const updatedNode: NodeSpec = {
    key: existing.key,
    type: existing.type,
    position: nextPosition,
    ...(nextLabel !== undefined ? { label: nextLabel } : {}),
    ...(nextGroupKey !== undefined ? { groupKey: nextGroupKey } : {}),
    ...(nextPassthrough !== undefined ? { passthrough: nextPassthrough } : {}),
  };

  const updatedNodes = tab.nodes.map((n, i) => (i === nodeIndex ? updatedNode : n));
  const updatedTab: TabSpec = { ...tab, nodes: updatedNodes };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, updated: true };
}
