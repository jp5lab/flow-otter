import type { AuthoringSpec, NodeSpec, TabSpec } from '../types.js';

import { defaultSpawnPosition } from './_spawn.js';

export interface AddLinkCallNodeOpts {
  /** Visible label (≤ 24 chars). Defaults to 'Link Call'. */
  label?: string;
  /** Custom key. Auto-generated as `link-call` (with collision suffix) if omitted. */
  key?: string;
  /** Node-RED link-call passthrough (links: must reference exactly one link-in; rule enforced by validator). */
  passthrough?: Readonly<Record<string, unknown>>;
  /** Membership in an existing group. */
  groupKey?: string;
}

export interface AddLinkCallNodeResult {
  spec: AuthoringSpec;
  newNodeKey: string;
}

const DEFAULTS = {
  label: 'Link Call',
  baseKey: 'link-call',
};

class AddLinkCallNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddLinkCallNodeError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addLinkCallNode(
  spec: AuthoringSpec,
  tabId: string,
  opts: AddLinkCallNodeOpts = {},
): AddLinkCallNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddLinkCallNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const taken = new Set(tab.nodes.map((n) => n.key));
  const newKey = uniqueKey(opts.key ?? DEFAULTS.baseKey, taken);
  const position = defaultSpawnPosition(tab);

  const newNode: NodeSpec = {
    key: newKey,
    type: 'link call',
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
