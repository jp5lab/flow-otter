import type { AuthoringSpec, GroupSpec, Position, TabSpec } from '../types.js';

import { updateMemberGroupKeys } from './_membership.js';

export interface UpdateGroupOpts {
  name?: string;
  nodeKeys?: readonly string[];
  position?: Position;
  size?: { readonly w: number; readonly h: number };
  /** `null` clears parent group membership; `undefined` leaves it as-is. */
  parentKey?: string | null;
  /** `null` clears group info; `undefined` leaves it as-is. */
  info?: string | null;
  /** `null` clears explicit style; `undefined` leaves it as-is. */
  style?: Readonly<Record<string, unknown>> | null;
  /** Replaces the existing passthrough wholesale. */
  passthrough?: Readonly<Record<string, unknown>>;
  /** Strips position+size so compile auto-fits the group from current members. */
  refit?: boolean;
}

export interface UpdateGroupResult {
  spec: AuthoringSpec;
  updated: boolean;
}

class UpdateGroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateGroupError';
  }
}

export function updateGroup(
  spec: AuthoringSpec,
  tabId: string,
  groupKey: string,
  opts: UpdateGroupOpts,
): UpdateGroupResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new UpdateGroupError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const existing = tab.groups.find((g) => g.key === groupKey);
  if (existing === undefined) {
    throw new UpdateGroupError(`Group '${groupKey}' not found on tab '${tabId}'.`);
  }

  const memberKeys = opts.nodeKeys ?? existing.nodeKeys;
  const membership = updateMemberGroupKeys(tab, groupKey, memberKeys);
  const groups = membership.groups.map((g) =>
    g.key === groupKey ? buildGroup(existing, opts, memberKeys) : g,
  );
  const updatedTab: TabSpec = {
    ...tab,
    ...membership,
    groups,
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, updated: true };
}

function resolveOptional<T>(current: T | undefined, update: T | null | undefined): T | undefined {
  if (update === undefined) return current;
  if (update === null) return undefined;
  return update;
}

function buildGroup(
  existing: GroupSpec,
  opts: UpdateGroupOpts,
  memberKeys: readonly string[],
): GroupSpec {
  const name = opts.name !== undefined ? opts.name : existing.name;
  const parentKey = resolveOptional(existing.parentKey, opts.parentKey);
  const info = resolveOptional(existing.info, opts.info);
  const style = resolveOptional(existing.style, opts.style);
  const passthrough = opts.passthrough !== undefined ? opts.passthrough : existing.passthrough;
  const position = opts.refit === true ? undefined : (opts.position ?? existing.position);
  const size = opts.refit === true ? undefined : (opts.size ?? existing.size);

  return {
    key: existing.key,
    name,
    nodeKeys: [...memberKeys],
    ...(position !== undefined ? { position } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(parentKey !== undefined ? { parentKey } : {}),
    ...(info !== undefined ? { info } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(passthrough !== undefined ? { passthrough } : {}),
  };
}
