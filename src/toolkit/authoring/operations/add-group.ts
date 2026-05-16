import type { AuthoringSpec, GroupSpec, TabSpec } from '../types.js';

export interface AddGroupOpts {
  /** Custom key. Auto-generated as `group` (with collision suffix) if omitted. */
  key?: string;
  /** Group label / name shown on the canvas. */
  name: string;
  /** Keys of existing nodes/comments to include in the group. Defaults to []. */
  nodeKeys?: readonly string[];
  /** Optional Node-RED group style overrides. */
  style?: Readonly<Record<string, unknown>>;
}

export interface AddGroupResult {
  spec: AuthoringSpec;
  newGroupKey: string;
}

const DEFAULTS = {
  baseKey: 'group',
};

class AddGroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddGroupError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addGroup(spec: AuthoringSpec, tabId: string, opts: AddGroupOpts): AddGroupResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddGroupError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const taken = new Set(tab.groups.map((g) => g.key));
  const newKey = uniqueKey(opts.key ?? DEFAULTS.baseKey, taken);

  const newGroup: GroupSpec = {
    key: newKey,
    name: opts.name,
    nodeKeys: opts.nodeKeys ?? [],
    ...(opts.style !== undefined ? { style: opts.style } : {}),
  };

  const updatedTab: TabSpec = {
    ...tab,
    groups: [...tab.groups, newGroup],
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, newGroupKey: newKey };
}
