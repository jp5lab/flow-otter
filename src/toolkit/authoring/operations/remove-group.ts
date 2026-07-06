import type { AuthoringSpec, GroupSpec, TabSpec } from '../types.js';

import { updateSingleMemberGroupKey } from './_membership.js';

export interface RemoveGroupResult {
  spec: AuthoringSpec;
  removed: boolean;
}

class RemoveGroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoveGroupError';
  }
}

export function removeGroup(
  spec: AuthoringSpec,
  tabId: string,
  groupKey: string,
): RemoveGroupResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new RemoveGroupError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const existing = tab.groups.find((g) => g.key === groupKey);
  if (existing === undefined) {
    throw new RemoveGroupError(`Group '${groupKey}' not found on tab '${tabId}'.`);
  }

  const nextParentKey = existing.parentKey;
  let workingTab: TabSpec = tab;
  const memberKeys = directMemberKeys(tab, existing);
  for (const memberKey of memberKeys) {
    const membership = updateSingleMemberGroupKey(workingTab, memberKey, nextParentKey);
    workingTab = { ...workingTab, ...membership };
  }

  const groups = workingTab.groups
    .filter((g) => g.key !== groupKey)
    .map((g) => {
      if (g.parentKey !== groupKey) return g;
      const withoutParent = { ...g };
      delete (withoutParent as { parentKey?: string }).parentKey;
      return nextParentKey === undefined
        ? withoutParent
        : { ...withoutParent, parentKey: nextParentKey };
    });

  const updatedTab: TabSpec = {
    ...workingTab,
    groups,
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, removed: true };
}

function directMemberKeys(tab: TabSpec, group: GroupSpec): readonly string[] {
  const members = new Set(group.nodeKeys);
  for (const n of tab.nodes) {
    if (n.groupKey === group.key) members.add(n.key);
  }
  for (const j of tab.junctions ?? []) {
    if (j.groupKey === group.key) members.add(j.key);
  }
  for (const c of tab.comments) {
    if (c.groupKey === group.key) members.add(c.key);
  }
  return [...members];
}
