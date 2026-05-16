import type { AuthoringSpec, CommentSpec, Position, TabSpec } from '../types.js';

import { defaultSpawnPosition } from './_spawn.js';

export interface AddCommentOpts {
  /** Custom key. Auto-generated as `comment` (with collision suffix) if omitted. */
  key?: string;
  /** Comment title / first line. Required. */
  text: string;
  /** Position. Defaults to `defaultSpawnPosition(tab)`. */
  position?: Position;
  /** Multi-line body. Optional. */
  info?: string;
  /** Membership in an existing group. */
  groupKey?: string;
}

export interface AddCommentResult {
  spec: AuthoringSpec;
  newCommentKey: string;
}

const DEFAULTS = {
  baseKey: 'comment',
};

class AddCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddCommentError';
  }
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function addComment(
  spec: AuthoringSpec,
  tabId: string,
  opts: AddCommentOpts,
): AddCommentResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new AddCommentError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const taken = new Set(tab.comments.map((c) => c.key));
  const newKey = uniqueKey(opts.key ?? DEFAULTS.baseKey, taken);
  const position = opts.position ?? defaultSpawnPosition(tab);

  const newComment: CommentSpec = {
    key: newKey,
    text: opts.text,
    position,
    ...(opts.info !== undefined ? { info: opts.info } : {}),
    ...(opts.groupKey !== undefined ? { groupKey: opts.groupKey } : {}),
  };

  const updatedTab: TabSpec = {
    ...tab,
    comments: [...tab.comments, newComment],
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, newCommentKey: newKey };
}
