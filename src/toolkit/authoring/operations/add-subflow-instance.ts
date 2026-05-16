import type { AuthoringSpec, NodeSpec, TabSpec } from '../types.js';

import { defaultSpawnPosition } from './_spawn.js';

export interface AddSubflowInstanceOpts {
  /** Visible label (≤ 24 chars). Defaults to 'Subflow'. */
  label?: string;
  /** Custom key. Auto-generated as `subflow-<defId>` (with collision suffix) if omitted. */
  key?: string;
  /** Type-specific passthrough (env overrides, etc.). */
  passthrough?: Readonly<Record<string, unknown>>;
  /** Membership in an existing group. */
  groupKey?: string;
}

export interface AddSubflowInstanceResult {
  spec: AuthoringSpec;
  newNodeKey: string;
}

const DEFAULTS = {
  label: 'Subflow',
};

class AddSubflowInstanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddSubflowInstanceError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addSubflowInstance(
  spec: AuthoringSpec,
  tabId: string,
  defId: string,
  opts: AddSubflowInstanceOpts = {},
): AddSubflowInstanceResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddSubflowInstanceError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const taken = new Set(tab.nodes.map((n) => n.key));
  const newKey = uniqueKey(opts.key ?? `subflow-${defId}`, taken);
  const position = defaultSpawnPosition(tab);

  const newNode: NodeSpec = {
    key: newKey,
    type: `subflow:${defId}`,
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
