import type { AuthoringSpec, NodeSpec, TabSpec } from '../types.js';

import { defaultSpawnPosition } from './_spawn.js';

export interface AddCatchNodeOpts {
  /** Visible label (≤ 24 chars). Defaults to 'Catch'. */
  label?: string;
  /** Custom key. Auto-generated as `catch` (with collision suffix) if omitted. */
  key?: string;
  /** Node-RED catch passthrough (scope, uncaught, etc.). */
  passthrough?: Readonly<Record<string, unknown>>;
  /** Membership in an existing group. */
  groupKey?: string;
}

export interface AddCatchNodeResult {
  spec: AuthoringSpec;
  newNodeKey: string;
}

const DEFAULTS = {
  label: 'Catch',
  baseKey: 'catch',
};

class AddCatchNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddCatchNodeError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addCatchNode(
  spec: AuthoringSpec,
  tabId: string,
  opts: AddCatchNodeOpts = {},
): AddCatchNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddCatchNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const taken = new Set(tab.nodes.map((n) => n.key));
  const newKey = uniqueKey(opts.key ?? DEFAULTS.baseKey, taken);
  const position = defaultSpawnPosition(tab);

  const newNode: NodeSpec = {
    key: newKey,
    type: 'catch',
    label: opts.label ?? DEFAULTS.label,
    position,
    ...(opts.groupKey !== undefined ? { groupKey: opts.groupKey } : {}),
    ...(opts.passthrough !== undefined ? { passthrough: opts.passthrough } : {}),
  };

  const updatedTab: TabSpec = {
    ...tab,
    nodes: [...tab.nodes, newNode],
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, newNodeKey: newKey };
}
