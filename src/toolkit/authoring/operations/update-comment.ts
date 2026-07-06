import type { AuthoringSpec, CommentSpec, Position, TabSpec } from '../types.js';

import { updateSingleMemberGroupKey, withGroupKey } from './_membership.js';

export interface UpdateCommentOpts {
  text?: string;
  position?: Position;
  size?: { readonly w: number; readonly h: number } | null;
  info?: string | null;
  /** `null` clears the group membership; `undefined` leaves it as-is. */
  groupKey?: string | null;
}

export interface UpdateCommentResult {
  spec: AuthoringSpec;
  updated: boolean;
}

class UpdateCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateCommentError';
  }
}

export function updateComment(
  spec: AuthoringSpec,
  tabId: string,
  commentKey: string,
  opts: UpdateCommentOpts,
): UpdateCommentResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new UpdateCommentError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const existing = tab.comments.find((c) => c.key === commentKey);
  if (existing === undefined) {
    throw new UpdateCommentError(`Comment '${commentKey}' not found on tab '${tabId}'.`);
  }

  const nextGroupKey = resolveGroupKey(existing.groupKey, opts.groupKey);
  const membership = updateSingleMemberGroupKey(tab, commentKey, nextGroupKey);
  const comments = membership.comments.map((c) =>
    c.key === commentKey ? buildComment(c, opts, nextGroupKey) : c,
  );
  const updatedTab: TabSpec = {
    ...tab,
    ...membership,
    comments,
  };
  const updatedTabs = spec.tabs.map((t, i) => (i === tabIndex ? updatedTab : t));
  return { spec: { ...spec, tabs: updatedTabs }, updated: true };
}

function resolveGroupKey(
  current: string | undefined,
  update: string | null | undefined,
): string | undefined {
  if (update === undefined) return current;
  if (update === null) return undefined;
  return update;
}

function buildComment(
  existing: CommentSpec,
  opts: UpdateCommentOpts,
  groupKey: string | undefined,
): CommentSpec {
  const text = opts.text !== undefined ? opts.text : existing.text;
  const position = opts.position ?? existing.position;
  const size = opts.size === undefined ? existing.size : opts.size === null ? undefined : opts.size;
  const info = opts.info === undefined ? existing.info : opts.info === null ? undefined : opts.info;

  return withGroupKey(
    {
      key: existing.key,
      text,
      position,
      ...(size !== undefined ? { size } : {}),
      ...(info !== undefined ? { info } : {}),
    },
    groupKey,
  );
}
