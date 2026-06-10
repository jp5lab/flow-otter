import type { AuthoringSpec, GroupSpec, Position, TabSpec } from '../types.js';

export interface AddGroupOpts {
  /** Custom key. Auto-generated as `group` (with collision suffix) if omitted. */
  key?: string;
  /** Group label / name shown on the canvas. */
  name: string;
  /** Keys of existing nodes/comments to include in the group. Defaults to []. */
  nodeKeys?: readonly string[];
  /** Top-left corner. If omitted, Node-RED can auto-fit the group. */
  position?: Position;
  /** Width/height in pixels. */
  size?: { readonly w: number; readonly h: number };
  /** Parent group key for nested groups. */
  parentKey?: string;
  /** Per-group info annotation. */
  info?: string;
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
  const memberKeys = new Set(opts.nodeKeys ?? []);

  const newGroup: GroupSpec = {
    key: newKey,
    name: opts.name,
    nodeKeys: opts.nodeKeys ?? [],
    ...(opts.position !== undefined ? { position: opts.position } : {}),
    ...(opts.size !== undefined ? { size: opts.size } : {}),
    ...(opts.parentKey !== undefined ? { parentKey: opts.parentKey } : {}),
    ...(opts.info !== undefined ? { info: opts.info } : {}),
    ...(opts.style !== undefined ? { style: opts.style } : {}),
  };

  const nodes = tab.nodes.map((n) => (memberKeys.has(n.key) ? { ...n, groupKey: newKey } : n));
  const comments = tab.comments.map((c) =>
    memberKeys.has(c.key) ? { ...c, groupKey: newKey } : c,
  );
  const junctions = tab.junctions?.map((j) =>
    memberKeys.has(j.key) ? { ...j, groupKey: newKey } : j,
  );
  const existingGroups = tab.groups.map((g) =>
    memberKeys.size === 0 ? g : { ...g, nodeKeys: g.nodeKeys.filter((k) => !memberKeys.has(k)) },
  );

  const updatedTab: TabSpec = {
    ...tab,
    nodes,
    groups: [...existingGroups, newGroup],
    comments,
    ...(junctions !== undefined ? { junctions } : {}),
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, newGroupKey: newKey };
}
