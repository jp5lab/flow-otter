import fc from 'fast-check';

import type {
  AuthoringSpec,
  CommentSpec,
  ConfigNodeSpec,
  ConnectionSpec,
  GroupSpec,
  JunctionSpec,
  NodeSpec,
  SubflowDefSpec,
  TabEnvEntry,
  TabSpec,
} from '../../src/toolkit/authoring/types.js';

const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Lowercase-alphanumeric string, ≥ minLength, ≤ maxLength. */
function alphaString(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...ALPHA.split('')), { minLength, maxLength })
    .map((chars) => chars.join(''));
}

const arbKey = alphaString(2, 6);

/** Labels are simple, non-blank, ≤ 20 chars (under the 24-char cap). */
const arbLabel = alphaString(1, 18).map((s) => s);

/** Position with integers; off-grid positions are allowed since compile preserves coords as-is. */
const arbPosition = fc.record({
  x: fc.integer({ min: 0, max: 2000 }),
  y: fc.integer({ min: 0, max: 1200 }),
});

const NODE_KINDS = ['inject', 'debug', 'function'] as const;
type NodeKind = (typeof NODE_KINDS)[number];

interface NodeProto {
  kind: NodeKind;
  position: { x: number; y: number };
  label: string;
}

const arbNodeProto: fc.Arbitrary<NodeProto> = fc.record({
  kind: fc.constantFrom<NodeKind>(...NODE_KINDS),
  position: arbPosition,
  label: arbLabel,
});

interface RawTab {
  id: string;
  label: string;
  nodeEntries: { key: string; proto: NodeProto }[];
  rawConnections: { fromKey: string; toKey: string; outputPort: number }[];
  junctionKeys: string[];
  groupEntries: {
    key: string;
    name: string;
    position: { x: number; y: number };
    size: { w: number; h: number };
    info: string | undefined;
  }[];
  commentEntries: {
    key: string;
    text: string;
    position: { x: number; y: number };
    size: { w: number; h: number } | undefined;
  }[];
  locked: boolean | undefined;
  envEntries: { name: string; type: TabEnvEntry['type']; value: string }[];
}

const ENV_TYPES: TabEnvEntry['type'][] = ['str', 'num', 'bool', 'json'];
const arbEnvEntry = fc.record({
  name: alphaString(2, 8),
  type: fc.constantFrom<TabEnvEntry['type']>(...ENV_TYPES),
  value: alphaString(1, 6),
});

function dedupeUniqueByKey<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

const arbTab: fc.Arbitrary<TabSpec> = fc
  .record<RawTab>({
    id: alphaString(4, 8),
    label: arbLabel,
    nodeEntries: fc.array(fc.record({ key: arbKey, proto: arbNodeProto }), {
      minLength: 1,
      maxLength: 5,
    }),
    rawConnections: fc.array(
      fc.record({ fromKey: arbKey, toKey: arbKey, outputPort: fc.constantFrom(0) }),
      { minLength: 0, maxLength: 4 },
    ),
    junctionKeys: fc.array(arbKey, { minLength: 0, maxLength: 2 }),
    groupEntries: fc.array(
      fc.record({
        key: arbKey,
        name: arbLabel,
        position: arbPosition,
        size: fc.record({
          w: fc.integer({ min: 50, max: 600 }),
          h: fc.integer({ min: 50, max: 400 }),
        }),
        info: fc.option(alphaString(1, 12)).map((s) => s ?? undefined),
      }),
      { minLength: 0, maxLength: 2 },
    ),
    commentEntries: fc.array(
      fc.record({
        key: arbKey,
        text: arbLabel,
        position: arbPosition,
        size: fc
          .option(
            fc.record({
              w: fc.integer({ min: 50, max: 400 }),
              h: fc.integer({ min: 20, max: 200 }),
            }),
          )
          .map((s) => s ?? undefined),
      }),
      { minLength: 0, maxLength: 2 },
    ),
    locked: fc.option(fc.boolean()).map((b) => b ?? undefined),
    envEntries: fc.array(arbEnvEntry, { minLength: 0, maxLength: 2 }),
  })
  .map((raw): TabSpec => {
    // Dedupe nodes by key
    const uniqueEntries = dedupeUniqueByKey(raw.nodeEntries, (e) => e.key);
    const nodes: NodeSpec[] = uniqueEntries.map(({ key, proto }) => ({
      key,
      type: proto.kind,
      label: proto.label,
      position: proto.position,
    }));
    const nodeKeys = new Set(nodes.map((n) => n.key));
    // Dedupe junctions, exclude any that collide with a node key.
    const uniqueJunctionKeys = Array.from(new Set(raw.junctionKeys)).filter(
      (k) => !nodeKeys.has(k),
    );
    const junctions: JunctionSpec[] = uniqueJunctionKeys.map((key, i) => ({
      key,
      position: { x: 800 + (i % 4) * 60, y: 100 + Math.floor(i / 4) * 80 },
    }));
    const validWireKeys = new Set<string>([...nodeKeys, ...uniqueJunctionKeys]);
    // Sources cannot be debug (0 output ports). Junctions ARE valid sources.
    const sourceKeys = new Set<string>([
      ...nodes.filter((n) => n.type !== 'debug').map((n) => n.key),
      ...uniqueJunctionKeys,
    ]);
    const filteredConn = raw.rawConnections.filter(
      (c) =>
        validWireKeys.has(c.fromKey) &&
        validWireKeys.has(c.toKey) &&
        sourceKeys.has(c.fromKey) &&
        c.fromKey !== c.toKey,
    );
    const dedupedConn: ConnectionSpec[] = dedupeUniqueByKey(
      filteredConn,
      (c) => `${c.fromKey}|${c.outputPort}|${c.toKey}`,
    );

    // Groups + comments dedupe by key against each other and against nodes/junctions.
    const reservedKeys = new Set<string>([...validWireKeys]);
    const uniqueGroups = dedupeUniqueByKey(raw.groupEntries, (g) => g.key).filter(
      (g) => !reservedKeys.has(g.key),
    );
    for (const g of uniqueGroups) reservedKeys.add(g.key);
    const groups: GroupSpec[] = uniqueGroups.map((g) => ({
      key: g.key,
      name: g.name,
      nodeKeys: [],
      position: g.position,
      size: g.size,
      ...(g.info !== undefined ? { info: g.info } : {}),
    }));

    const uniqueComments = dedupeUniqueByKey(raw.commentEntries, (c) => c.key).filter(
      (c) => !reservedKeys.has(c.key),
    );
    const comments: CommentSpec[] = uniqueComments.map((c) => ({
      key: c.key,
      text: c.text,
      position: c.position,
      ...(c.size !== undefined ? { size: c.size } : {}),
    }));

    // Dedupe env entries by name.
    const uniqueEnv = dedupeUniqueByKey(raw.envEntries, (e) => e.name);
    const env: TabEnvEntry[] = uniqueEnv.map((e) => ({
      name: e.name,
      type: e.type,
      value: e.value,
    }));

    const tab: TabSpec = {
      id: raw.id,
      label: raw.label,
      nodes,
      connections: dedupedConn,
      groups,
      comments,
      ...(junctions.length > 0 ? { junctions } : {}),
      ...(raw.locked !== undefined ? { locked: raw.locked } : {}),
      ...(env.length > 0 ? { env } : {}),
    };
    return tab;
  });

interface RawSubflowDef {
  id: string;
  name: string;
  nodeEntries: { key: string; proto: NodeProto }[];
  rawConnections: { fromKey: string; toKey: string; outputPort: number }[];
}

const arbSubflowDef: fc.Arbitrary<SubflowDefSpec> = fc
  .record<RawSubflowDef>({
    id: alphaString(4, 8),
    name: arbLabel,
    nodeEntries: fc.array(fc.record({ key: arbKey, proto: arbNodeProto }), {
      minLength: 0,
      maxLength: 3,
    }),
    rawConnections: fc.array(
      fc.record({ fromKey: arbKey, toKey: arbKey, outputPort: fc.constantFrom(0) }),
      { minLength: 0, maxLength: 2 },
    ),
  })
  .map((raw): SubflowDefSpec => {
    const uniqueEntries = dedupeUniqueByKey(raw.nodeEntries, (e) => e.key);
    const nodes: NodeSpec[] = uniqueEntries.map(({ key, proto }) => ({
      key,
      type: proto.kind,
      label: proto.label,
      position: proto.position,
    }));
    const validKeys = new Set(nodes.map((n) => n.key));
    const sourceKeys = new Set(nodes.filter((n) => n.type !== 'debug').map((n) => n.key));
    const filteredConn = raw.rawConnections.filter(
      (c) =>
        validKeys.has(c.fromKey) &&
        validKeys.has(c.toKey) &&
        sourceKeys.has(c.fromKey) &&
        c.fromKey !== c.toKey,
    );
    const dedupedConn: ConnectionSpec[] = dedupeUniqueByKey(
      filteredConn,
      (c) => `${c.fromKey}|${c.outputPort}|${c.toKey}`,
    );
    return {
      id: raw.id,
      name: raw.name,
      nodes,
      connections: dedupedConn,
    };
  });

export const arbitraryAuthoringSpec: fc.Arbitrary<AuthoringSpec> = fc
  .tuple(
    fc.array(arbTab, { minLength: 1, maxLength: 3 }),
    fc.array(arbSubflowDef, { minLength: 0, maxLength: 2 }),
  )
  .map(([tabs, defs]) => {
    const uniqueTabs = dedupeUniqueByKey(tabs, (t) => t.id);
    const tabIds = new Set(uniqueTabs.map((t) => t.id));
    const uniqueDefs = dedupeUniqueByKey(defs, (d) => d.id).filter((d) => !tabIds.has(d.id));
    if (uniqueDefs.length === 0) return { tabs: uniqueTabs };
    return { tabs: uniqueTabs, subflowDefs: uniqueDefs };
  })
  .filter((spec) => spec.tabs.length > 0);

function compareConnections(a: ConnectionSpec, b: ConnectionSpec): number {
  if (a.fromKey !== b.fromKey) return a.fromKey.localeCompare(b.fromKey);
  if (a.outputPort !== b.outputPort) return a.outputPort - b.outputPort;
  return a.toKey.localeCompare(b.toKey);
}

/** Sorts tabs and tab contents into a canonical order for structural equality. */
export function canonicalizeSpec(spec: AuthoringSpec): AuthoringSpec {
  const tabs = [...spec.tabs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t): TabSpec => {
      const out: TabSpec = {
        ...t,
        nodes: [...t.nodes].sort((a, b) => a.key.localeCompare(b.key)),
        connections: [...t.connections].sort(compareConnections),
        groups: [...t.groups]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((g) => ({ ...g, nodeKeys: [...g.nodeKeys].sort() })),
        comments: [...t.comments].sort((a, b) => a.key.localeCompare(b.key)),
        ...(t.junctions !== undefined
          ? { junctions: [...t.junctions].sort((a, b) => a.key.localeCompare(b.key)) }
          : {}),
      };
      return out;
    });
  const configNodes: ConfigNodeSpec[] = [...(spec.configNodes ?? [])].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const subflowDefs = [...(spec.subflowDefs ?? [])]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => ({
      ...d,
      nodes: [...d.nodes].sort((a, b) => a.key.localeCompare(b.key)),
      connections: [...d.connections].sort(compareConnections),
    }));
  return {
    tabs,
    ...(configNodes.length > 0 ? { configNodes } : {}),
    ...(subflowDefs.length > 0 ? { subflowDefs } : {}),
  };
}

type Transformation =
  | 'identity'
  | 'cross-tab-move'
  | 'delete-node'
  | 'add-node'
  | 'add-duplicate-group-on-new-tab'
  | 'add-duplicate-comment-on-new-tab'
  | 'multi-edit';

function moveCrossTab(before: AuthoringSpec, seed: number): AuthoringSpec {
  if (before.tabs.length < 2) return before;
  const sourceIdx = seed % before.tabs.length;
  const sourceTab = before.tabs[sourceIdx]!;
  if (sourceTab.nodes.length === 0) return before;
  const node = sourceTab.nodes[seed % sourceTab.nodes.length]!;
  const destTab = before.tabs.find(
    (t) => t.id !== sourceTab.id && !t.nodes.some((n) => n.key === node.key),
  );
  if (!destTab) return before;
  const newTabs: TabSpec[] = before.tabs.map((t): TabSpec => {
    if (t.id === sourceTab.id) {
      return {
        ...t,
        nodes: t.nodes.filter((n) => n.key !== node.key),
        connections: t.connections.filter((c) => c.fromKey !== node.key && c.toKey !== node.key),
      };
    }
    if (t.id === destTab.id) {
      return { ...t, nodes: [...t.nodes, node] };
    }
    return t;
  });
  return { tabs: newTabs };
}

function deleteOneNode(before: AuthoringSpec, seed: number): AuthoringSpec {
  const tabIdx = before.tabs.findIndex((t) => t.nodes.length > 0);
  if (tabIdx < 0) return before;
  const tab = before.tabs[tabIdx]!;
  const node = tab.nodes[seed % tab.nodes.length]!;
  return {
    tabs: before.tabs.map((t, i): TabSpec => {
      if (i !== tabIdx) return t;
      return {
        ...t,
        nodes: t.nodes.filter((n) => n.key !== node.key),
        connections: t.connections.filter((c) => c.fromKey !== node.key && c.toKey !== node.key),
      };
    }),
  };
}

function addOneNode(before: AuthoringSpec, seed: number): AuthoringSpec {
  if (before.tabs.length === 0) return before;
  const tabIdx = seed % before.tabs.length;
  const tab = before.tabs[tabIdx]!;
  const newKey = `add${seed}`;
  if (tab.nodes.some((n) => n.key === newKey)) return before;
  const newNode: NodeSpec = {
    key: newKey,
    type: 'inject',
    label: 'Added',
    position: { x: 100 + (seed % 10) * 20, y: 100 + (seed % 5) * 20 },
  };
  return {
    tabs: before.tabs.map(
      (t, i): TabSpec => (i === tabIdx ? { ...t, nodes: [...t.nodes, newNode] } : t),
    ),
  };
}

function freshTabId(before: AuthoringSpec, seed: number): string {
  const existing = new Set(before.tabs.map((t) => t.id));
  let id = `newtab${seed}`;
  let suffix = 2;
  while (existing.has(id)) {
    id = `newtab${seed}-${suffix}`;
    suffix++;
  }
  return id;
}

function addDuplicateGroupOnNewTab(before: AuthoringSpec, seed: number): AuthoringSpec {
  const sourceTab = before.tabs.find((t) => t.groups.length > 0);
  if (!sourceTab) return before;
  const sourceGroup = sourceTab.groups[seed % sourceTab.groups.length]!;
  const newTab: TabSpec = {
    id: freshTabId(before, seed),
    label: 'New group tab',
    nodes: [],
    connections: [],
    groups: [
      {
        key: sourceGroup.key,
        name: sourceGroup.name,
        nodeKeys: [],
        ...(sourceGroup.position !== undefined ? { position: sourceGroup.position } : {}),
        ...(sourceGroup.size !== undefined ? { size: sourceGroup.size } : {}),
      },
    ],
    comments: [],
  };
  const tabs = seed % 2 === 0 ? [...before.tabs, newTab] : [newTab, ...before.tabs];
  return { ...before, tabs };
}

function addDuplicateCommentOnNewTab(before: AuthoringSpec, seed: number): AuthoringSpec {
  const sourceTab = before.tabs.find((t) => t.comments.length > 0);
  if (!sourceTab) return before;
  const sourceComment = sourceTab.comments[seed % sourceTab.comments.length]!;
  const newTab: TabSpec = {
    id: freshTabId(before, seed),
    label: 'New comment tab',
    nodes: [],
    connections: [],
    groups: [],
    comments: [
      {
        key: sourceComment.key,
        text: sourceComment.text,
        position: sourceComment.position,
        ...(sourceComment.size !== undefined ? { size: sourceComment.size } : {}),
      },
    ],
  };
  const tabs = seed % 2 === 0 ? [...before.tabs, newTab] : [newTab, ...before.tabs];
  return { ...before, tabs };
}

function multiEdit(before: AuthoringSpec, seed: number): AuthoringSpec {
  const suffix = (seed % 90) + 10;
  return {
    tabs: before.tabs.map(
      (t): TabSpec => ({
        ...t,
        nodes: t.nodes.map(
          (n): NodeSpec => ({ ...n, label: `${(n.label ?? n.type).slice(0, 18)}${suffix}` }),
        ),
      }),
    ),
  };
}

function applyTransformation(
  before: AuthoringSpec,
  kind: Transformation,
  seed: number,
): AuthoringSpec {
  switch (kind) {
    case 'identity':
      return before;
    case 'cross-tab-move':
      return moveCrossTab(before, seed);
    case 'delete-node':
      return deleteOneNode(before, seed);
    case 'add-node':
      return addOneNode(before, seed);
    case 'add-duplicate-group-on-new-tab':
      return addDuplicateGroupOnNewTab(before, seed);
    case 'add-duplicate-comment-on-new-tab':
      return addDuplicateCommentOnNewTab(before, seed);
    case 'multi-edit':
      return multiEdit(before, seed);
  }
}

export interface SpecPair {
  before: AuthoringSpec;
  after: AuthoringSpec;
  kind: Transformation;
}

export const arbitrarySpecPair: fc.Arbitrary<SpecPair> = fc
  .tuple(
    arbitraryAuthoringSpec,
    fc.constantFrom<Transformation>(
      'identity',
      'cross-tab-move',
      'delete-node',
      'add-node',
      'add-duplicate-group-on-new-tab',
      'add-duplicate-comment-on-new-tab',
      'multi-edit',
    ),
    fc.integer({ min: 0, max: 9999 }),
  )
  .map(([before, kind, seed]) => ({
    before,
    after: applyTransformation(before, kind, seed),
    kind,
  }));

export interface CrossTabMove {
  before: AuthoringSpec;
  after: AuthoringSpec;
  movedNodeKey: string;
  sourceTabKey: string;
  destTabKey: string;
}

export const arbitraryCrossTabMove: fc.Arbitrary<CrossTabMove> = arbitraryAuthoringSpec
  .filter((spec) => spec.tabs.length >= 2 && spec.tabs.some((t) => t.nodes.length > 0))
  .map((before): CrossTabMove | null => {
    const sourceTab = before.tabs.find((t) => t.nodes.length > 0);
    if (!sourceTab) return null;
    const node = sourceTab.nodes[0]!;
    const otherTabs = before.tabs.filter((t) => t.id !== sourceTab.id);
    if (otherTabs.some((t) => t.nodes.some((n) => n.key === node.key))) return null;
    const destTab = otherTabs[0];
    if (!destTab) return null;
    const newTabs: TabSpec[] = before.tabs.map((t): TabSpec => {
      if (t.id === sourceTab.id) {
        return {
          ...t,
          nodes: t.nodes.filter((n) => n.key !== node.key),
          connections: t.connections.filter((c) => c.fromKey !== node.key && c.toKey !== node.key),
        };
      }
      if (t.id === destTab.id) {
        return { ...t, nodes: [...t.nodes, node] };
      }
      return t;
    });
    return {
      before,
      after: { tabs: newTabs },
      movedNodeKey: node.key,
      sourceTabKey: sourceTab.id,
      destTabKey: destTab.id,
    };
  })
  .filter((x): x is CrossTabMove => x !== null);
