import type { AuthoringSpec, TabSpec } from '../types.js';

import { scrubMemberFromGroups } from './_membership.js';

export interface RemoveCommentResult {
  spec: AuthoringSpec;
  removed: boolean;
}

class RemoveCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoveCommentError';
  }
}

export function removeComment(
  spec: AuthoringSpec,
  tabId: string,
  commentKey: string,
): RemoveCommentResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new RemoveCommentError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  if (!tab.comments.some((c) => c.key === commentKey)) {
    throw new RemoveCommentError(`Comment '${commentKey}' not found on tab '${tabId}'.`);
  }

  const updatedTab: TabSpec = {
    ...tab,
    comments: tab.comments.filter((c) => c.key !== commentKey),
    groups: scrubMemberFromGroups(tab.groups, commentKey),
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, removed: true };
}
