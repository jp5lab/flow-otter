import type { AuthoringSpec, GroupSpec, TabSpec } from '../types.js';

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

  const present = tab.nodes.some((n) => n.key === nodeKey);
  if (!present) {
    return { spec, removed: false };
  }

  const filteredNodes = tab.nodes.filter((n) => n.key !== nodeKey);
  const filteredConnections = tab.connections.filter(
    (c) => c.fromKey !== nodeKey && c.toKey !== nodeKey,
  );
  const scrubbedGroups: readonly GroupSpec[] = tab.groups.map((g) =>
    g.nodeKeys.includes(nodeKey) ? { ...g, nodeKeys: g.nodeKeys.filter((k) => k !== nodeKey) } : g,
  );

  const updatedTab: TabSpec = {
    ...tab,
    nodes: filteredNodes,
    connections: filteredConnections,
    groups: scrubbedGroups,
  };

  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, removed: true };
}
