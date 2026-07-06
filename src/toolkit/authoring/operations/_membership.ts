import type { CommentSpec, GroupSpec, JunctionSpec, NodeSpec, TabSpec } from '../types.js';

export type CanvasObjectKind = 'node' | 'junction' | 'comment';

export type CanvasObject =
  | { readonly kind: 'node'; readonly value: NodeSpec }
  | { readonly kind: 'junction'; readonly value: JunctionSpec }
  | { readonly kind: 'comment'; readonly value: CommentSpec };

export function findCanvasObject(tab: TabSpec, key: string): CanvasObject | undefined {
  const node = tab.nodes.find((n) => n.key === key);
  if (node !== undefined) return { kind: 'node', value: node };
  const junction = tab.junctions?.find((j) => j.key === key);
  if (junction !== undefined) return { kind: 'junction', value: junction };
  const comment = tab.comments.find((c) => c.key === key);
  if (comment !== undefined) return { kind: 'comment', value: comment };
  return undefined;
}

export function hasCanvasObject(tab: TabSpec, key: string): boolean {
  return findCanvasObject(tab, key) !== undefined;
}

export function scrubMemberFromGroups(
  groups: readonly GroupSpec[],
  memberKey: string,
): readonly GroupSpec[] {
  return groups.map((g) => {
    if (!g.nodeKeys.includes(memberKey)) return g;
    return { ...g, nodeKeys: g.nodeKeys.filter((k) => k !== memberKey) };
  });
}

export function updateMemberGroupKeys(
  tab: TabSpec,
  groupKey: string,
  memberKeys: readonly string[],
): Pick<TabSpec, 'nodes' | 'groups' | 'comments'> & {
  readonly junctions?: readonly JunctionSpec[];
} {
  const members = new Set(memberKeys);
  const nodes = tab.nodes.map((n) => withGroupKey(n, nextGroupKey(n.key, n.groupKey)));
  const junctions = tab.junctions?.map((j) => withGroupKey(j, nextGroupKey(j.key, j.groupKey)));
  const comments = tab.comments.map((c) => withGroupKey(c, nextGroupKey(c.key, c.groupKey)));
  const groups = tab.groups.map((g) => {
    if (g.key === groupKey) return { ...g, nodeKeys: [...memberKeys] };
    const nodeKeys = g.nodeKeys.filter((k) => !members.has(k));
    return nodeKeys.length === g.nodeKeys.length ? g : { ...g, nodeKeys };
  });

  const result: Pick<TabSpec, 'nodes' | 'groups' | 'comments'> & {
    junctions?: readonly JunctionSpec[];
  } = { nodes, groups, comments };
  if (junctions !== undefined) result.junctions = junctions;
  return result;

  function nextGroupKey(key: string, current: string | undefined): string | undefined {
    if (members.has(key)) return groupKey;
    return current === groupKey ? undefined : current;
  }
}

export function updateSingleMemberGroupKey(
  tab: TabSpec,
  memberKey: string,
  groupKey: string | undefined,
): Pick<TabSpec, 'nodes' | 'groups' | 'comments'> & {
  readonly junctions?: readonly JunctionSpec[];
} {
  const nodes = tab.nodes.map((n) => (n.key === memberKey ? withGroupKey(n, groupKey) : n));
  const junctions = tab.junctions?.map((j) =>
    j.key === memberKey ? withGroupKey(j, groupKey) : j,
  );
  const comments = tab.comments.map((c) => (c.key === memberKey ? withGroupKey(c, groupKey) : c));
  const groups = tab.groups.map((g) => {
    const without = g.nodeKeys.filter((k) => k !== memberKey);
    if (g.key !== groupKey) {
      return without.length === g.nodeKeys.length ? g : { ...g, nodeKeys: without };
    }
    return { ...g, nodeKeys: without.includes(memberKey) ? without : [...without, memberKey] };
  });

  const result: Pick<TabSpec, 'nodes' | 'groups' | 'comments'> & {
    junctions?: readonly JunctionSpec[];
  } = { nodes, groups, comments };
  if (junctions !== undefined) result.junctions = junctions;
  return result;
}

export function withGroupKey<T extends NodeSpec | JunctionSpec | CommentSpec>(
  value: T,
  groupKey: string | undefined,
): T {
  const without = { ...value };
  delete (without as { groupKey?: string }).groupKey;
  return groupKey === undefined ? without : { ...without, groupKey };
}
