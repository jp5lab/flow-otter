import type {
  AuthoringSpec,
  CommentSpec,
  JunctionSpec,
  NodeSpec,
  Position,
  TabSpec,
} from '../types.js';

import { findCanvasObject, updateSingleMemberGroupKey, withGroupKey } from './_membership.js';

export interface UpdateNodeOpts {
  label?: string;
  /** `null` clears the regular node info; `undefined` leaves it as-is. */
  info?: string | null;
  position?: Position;
  /** `null` clears the group membership; `undefined` leaves it as-is. */
  groupKey?: string | null;
  /** Junction-only disabled flag. Regular nodes can set `d` through passthrough. */
  disabled?: boolean;
  /** Replaces the existing passthrough wholesale (no merge). */
  passthrough?: Readonly<Record<string, unknown>>;
}

export interface UpdateNodeResult {
  spec: AuthoringSpec;
  updated: boolean;
}

class UpdateNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateNodeError';
  }
}

export function updateNode(
  spec: AuthoringSpec,
  tabId: string,
  nodeKey: string,
  opts: UpdateNodeOpts,
): UpdateNodeResult {
  const tabIndex = spec.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) throw new UpdateNodeError(`Tab '${tabId}' not found in spec.`);
  const tab = spec.tabs[tabIndex] as TabSpec;

  const target = findCanvasObject(tab, nodeKey);
  if (target === undefined) {
    throw new UpdateNodeError(
      `Node, junction, or comment '${nodeKey}' not found on tab '${tabId}'.`,
    );
  }

  const currentGroupKey = target.value.groupKey;
  const nextGroupKey = resolveGroupKey(currentGroupKey, opts.groupKey);
  const membership = updateSingleMemberGroupKey(tab, nodeKey, nextGroupKey);

  const updatedTab = applyTargetUpdate({ ...tab, ...membership }, target.kind, nodeKey, opts);
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

function applyTargetUpdate(
  tab: TabSpec,
  kind: 'node' | 'junction' | 'comment',
  key: string,
  opts: UpdateNodeOpts,
): TabSpec {
  if (kind === 'node') {
    const nodes = tab.nodes.map((n) => (n.key === key ? updateRegularNode(n, opts) : n));
    return { ...tab, nodes };
  }
  if (kind === 'junction') {
    if (opts.passthrough !== undefined || opts.info !== undefined) {
      throw new UpdateNodeError(
        `Junction '${key}' does not support passthrough or info updates; use label, position, group_key, or disabled.`,
      );
    }
    const junctions = (tab.junctions ?? []).map((j) =>
      j.key === key ? updateJunction(j, opts) : j,
    );
    return { ...tab, junctions };
  }
  if (opts.passthrough !== undefined || opts.disabled !== undefined || opts.info !== undefined) {
    throw new UpdateNodeError(
      `Comment '${key}' does not support passthrough, disabled, or info updates; use update_comment for full comment fields.`,
    );
  }
  const comments = tab.comments.map((c) => (c.key === key ? updateCommentViaNode(c, opts) : c));
  return { ...tab, comments };
}

function updateRegularNode(existing: NodeSpec, opts: UpdateNodeOpts): NodeSpec {
  const nextLabel = opts.label !== undefined ? opts.label : existing.label;
  const nextInfo =
    opts.info !== undefined ? (opts.info === null ? undefined : opts.info) : existing.info;
  const nextPosition = opts.position ?? existing.position;
  let nextPassthrough = opts.passthrough !== undefined ? opts.passthrough : existing.passthrough;
  if (opts.disabled !== undefined) {
    nextPassthrough = { ...(nextPassthrough ?? {}), d: opts.disabled };
  }
  const nextGroupKey = resolveGroupKey(existing.groupKey, opts.groupKey);

  return {
    key: existing.key,
    type: existing.type,
    position: nextPosition,
    ...(nextLabel !== undefined ? { label: nextLabel } : {}),
    ...(nextInfo !== undefined ? { info: nextInfo } : {}),
    ...(nextGroupKey !== undefined ? { groupKey: nextGroupKey } : {}),
    ...(existing.widgetAnchor !== undefined ? { widgetAnchor: existing.widgetAnchor } : {}),
    ...(nextPassthrough !== undefined ? { passthrough: nextPassthrough } : {}),
  };
}

function updateJunction(existing: JunctionSpec, opts: UpdateNodeOpts): JunctionSpec {
  const nextName = opts.label !== undefined ? opts.label : existing.name;
  const nextPosition = opts.position ?? existing.position;
  const nextGroupKey = resolveGroupKey(existing.groupKey, opts.groupKey);
  const nextDisabled = opts.disabled !== undefined ? opts.disabled : existing.disabled;

  return withGroupKey(
    {
      key: existing.key,
      position: nextPosition,
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextDisabled !== undefined ? { disabled: nextDisabled } : {}),
    },
    nextGroupKey,
  );
}

function updateCommentViaNode(existing: CommentSpec, opts: UpdateNodeOpts): CommentSpec {
  const nextText = opts.label !== undefined ? opts.label : existing.text;
  const nextPosition = opts.position ?? existing.position;
  const nextGroupKey = resolveGroupKey(existing.groupKey, opts.groupKey);

  return withGroupKey(
    {
      key: existing.key,
      text: nextText,
      position: nextPosition,
      ...(existing.size !== undefined ? { size: existing.size } : {}),
      ...(existing.info !== undefined ? { info: existing.info } : {}),
    },
    nextGroupKey,
  );
}
