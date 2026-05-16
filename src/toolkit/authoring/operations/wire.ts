import type { AuthoringSpec, ConnectionSpec, TabSpec } from '../types.js';

export interface WireNodesOpts {
  outputPort?: number;
}

export interface WireNodesResult {
  spec: AuthoringSpec;
  /** True if a new connection was added; false if the connection already existed. */
  added: boolean;
}

class WireNodesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireNodesError';
  }
}

export function wireNodes(
  spec: AuthoringSpec,
  tabId: string,
  fromKey: string,
  toKey: string,
  opts: WireNodesOpts = {},
): WireNodesResult {
  const port = opts.outputPort ?? 0;

  if (fromKey === toKey) {
    throw new WireNodesError(`Refusing to wire node '${fromKey}' to itself on tab '${tabId}'.`);
  }

  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new WireNodesError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const hasFrom = tab.nodes.some((n) => n.key === fromKey);
  if (!hasFrom) {
    throw new WireNodesError(`Source node '${fromKey}' not found on tab '${tabId}'.`);
  }
  const hasTo = tab.nodes.some((n) => n.key === toKey);
  if (!hasTo) {
    throw new WireNodesError(`Target node '${toKey}' not found on tab '${tabId}'.`);
  }

  const exists = tab.connections.some(
    (c) => c.fromKey === fromKey && c.outputPort === port && c.toKey === toKey,
  );
  if (exists) {
    return { spec, added: false };
  }

  const newConnection: ConnectionSpec = {
    fromKey,
    outputPort: port,
    toKey,
  };

  const updatedTab: TabSpec = {
    ...tab,
    connections: [...tab.connections, newConnection],
  };

  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, added: true };
}
