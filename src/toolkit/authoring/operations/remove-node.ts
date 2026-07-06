import type { AuthoringSpec, TabSpec } from '../types.js';

import { findCanvasObject, scrubMemberFromGroups } from './_membership.js';

export interface RemoveNodeResult {
  spec: AuthoringSpec;
  removed: boolean;
}

class RemoveNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoveNodeError';
  }
}

export function removeNode(spec: AuthoringSpec, tabId: string, nodeKey: string): RemoveNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new RemoveNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const target = findCanvasObject(tab, nodeKey);
  if (target === undefined) {
    throw new RemoveNodeError(
      `Node, junction, or comment '${nodeKey}' not found on tab '${tabId}'.`,
    );
  }

  const filteredNodes =
    target.kind === 'node' ? tab.nodes.filter((n) => n.key !== nodeKey) : tab.nodes;
  const filteredJunctions =
    target.kind === 'junction'
      ? (tab.junctions ?? []).filter((j) => j.key !== nodeKey)
      : tab.junctions;
  const filteredComments =
    target.kind === 'comment' ? tab.comments.filter((c) => c.key !== nodeKey) : tab.comments;
  const filteredConnections = tab.connections.filter(
    (c) => c.fromKey !== nodeKey && c.toKey !== nodeKey,
  );
  const scrubbedGroups = scrubMemberFromGroups(tab.groups, nodeKey);

  const updatedTab: TabSpec = {
    ...tab,
    nodes: filteredNodes,
    ...(filteredJunctions !== undefined ? { junctions: filteredJunctions } : {}),
    connections: filteredConnections,
    groups: scrubbedGroups,
    comments: filteredComments,
  };

  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, removed: true };
}
