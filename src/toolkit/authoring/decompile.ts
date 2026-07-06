import {
  configByReferenceIds,
  type CommentNode,
  type FlowsJson,
  type FlowsJsonNode,
  type GroupNode,
  type JunctionNode,
  type RegularNode,
  type SubflowDefNode,
  type TabNode,
  isComment,
  isConfigShapedNode,
  isGroup,
  isJunction,
  isRegularNode,
  isSubflowDef,
  isTab,
  SUBFLOW_INSTANCE_PREFIX,
} from '../../shared/flows-json.js';

import { AUTHORING_KEY_FIELD, DEFAULT_GROUP_STYLE } from './compile.js';
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
} from './types.js';

const STRUCTURAL_FIELDS = new Set([
  'id',
  'type',
  'z',
  'x',
  'y',
  'wires',
  'name',
  'g',
  AUTHORING_KEY_FIELD,
  // Runtime-built artifacts that should never round-trip into the AuthoringSpec.
  // _users / _alias are added by the runtime; credentials get stripped to avoid
  // leaking secrets via flows.json (Node-RED stores them in a sibling file).
  '_users',
  '_alias',
  'credentials',
]);

const STRUCTURAL_GROUP_FIELDS = new Set([
  'id',
  'type',
  'z',
  'x',
  'y',
  'w',
  'h',
  'name',
  'style',
  'nodes',
  'g',
  'info',
  AUTHORING_KEY_FIELD,
]);

const STRUCTURAL_TAB_FIELDS = new Set([
  'id',
  'type',
  'label',
  'disabled',
  'info',
  'locked',
  'env',
  AUTHORING_KEY_FIELD,
]);

const STRUCTURAL_SUBFLOW_DEF_FIELDS = new Set(['id', 'type', 'name', AUTHORING_KEY_FIELD]);

const STRUCTURAL_CONFIG_FIELDS = new Set([
  'id',
  'type',
  'name',
  '_users',
  '_alias',
  'credentials',
  AUTHORING_KEY_FIELD,
]);

function pickPassthrough(node: FlowsJsonNode, knownFields: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    if (knownFields.has(key)) continue;
    result[key] = (node as Record<string, unknown>)[key];
  }
  return result;
}

function authoringKey(node: FlowsJsonNode): string {
  const ext = (node as Record<string, unknown>)[AUTHORING_KEY_FIELD];
  return typeof ext === 'string' ? ext : node.id;
}

interface TabBuckets {
  nodes: RegularNode[];
  groups: GroupNode[];
  comments: CommentNode[];
  junctions: JunctionNode[];
}

function emptyBucket(): TabBuckets {
  return { nodes: [], groups: [], comments: [], junctions: [] };
}

interface WireSource {
  readonly id: string;
  readonly wires: ReadonlyArray<ReadonlyArray<string>>;
}

function buildBodyConnections(
  sources: readonly WireSource[],
  idToKey: Map<string, string>,
): ConnectionSpec[] {
  const connections: ConnectionSpec[] = [];
  for (const src of sources) {
    const fromKey = idToKey.get(src.id);
    if (!fromKey) continue;
    for (let port = 0; port < src.wires.length; port++) {
      const targets = src.wires[port] ?? [];
      for (const tid of targets) {
        const toKey = idToKey.get(tid);
        if (!toKey) continue;
        connections.push({ fromKey, outputPort: port, toKey });
      }
    }
  }
  return connections;
}

export function decompile(flows: FlowsJson): AuthoringSpec {
  const tabsById = new Map<string, TabNode>();
  const subflowDefsById = new Map<string, SubflowDefNode>();
  const configNodes: RegularNode[] = [];
  const buckets = new Map<string, TabBuckets>();
  const configIds = configByReferenceIds(flows);

  for (const node of flows) {
    if (isTab(node)) {
      tabsById.set(node.id, node);
      if (!buckets.has(node.id)) buckets.set(node.id, emptyBucket());
    } else if (isSubflowDef(node)) {
      subflowDefsById.set(node.id, node);
      if (!buckets.has(node.id)) buckets.set(node.id, emptyBucket());
    }
  }

  for (const node of flows) {
    if (isTab(node) || isSubflowDef(node)) continue;
    if (isConfigShapedNode(node, configIds)) {
      configNodes.push(node);
      continue;
    }
    if (isGroup(node)) {
      const z = node.z;
      const bucket = buckets.get(z) ?? emptyBucket();
      bucket.groups.push(node);
      buckets.set(z, bucket);
      continue;
    }
    if (isComment(node)) {
      const z = node.z;
      const bucket = buckets.get(z) ?? emptyBucket();
      bucket.comments.push(node);
      buckets.set(z, bucket);
      continue;
    }
    if (isJunction(node)) {
      const z = node.z;
      const bucket = buckets.get(z) ?? emptyBucket();
      bucket.junctions.push(node);
      buckets.set(z, bucket);
      continue;
    }
    if (isRegularNode(node)) {
      const regularNode = node as RegularNode;
      const z = regularNode.z;
      if (typeof z !== 'string') continue;
      const bucket = buckets.get(z) ?? emptyBucket();
      bucket.nodes.push(regularNode);
      buckets.set(z, bucket);
      continue;
    }
  }

  // Map subflow-def Node-RED ids → authoring keys so subflow-instance type
  // strings round-trip as `subflow:<authoringKey>` in the spec.
  const subflowDefIdToKey = new Map<string, string>();
  for (const [defId, defNode] of subflowDefsById) {
    subflowDefIdToKey.set(defId, authoringKey(defNode));
  }

  const tabs: TabSpec[] = [];
  for (const [tabId, tabNode] of tabsById) {
    const bucket = buckets.get(tabId) ?? emptyBucket();

    const idToKey = new Map<string, string>();
    for (const n of bucket.nodes) idToKey.set(n.id, authoringKey(n));
    for (const g of bucket.groups) idToKey.set(g.id, authoringKey(g));
    for (const c of bucket.comments) idToKey.set(c.id, authoringKey(c));
    for (const j of bucket.junctions) idToKey.set(j.id, authoringKey(j));

    const nodes: NodeSpec[] = bucket.nodes.map((n) => buildNodeSpec(n, idToKey, subflowDefIdToKey));
    const groups: GroupSpec[] = bucket.groups.map((g) => buildGroupSpec(g, idToKey));
    const comments: CommentSpec[] = bucket.comments.map((c) => buildCommentSpec(c, idToKey));
    const junctions: JunctionSpec[] = bucket.junctions.map((j) => buildJunctionSpec(j, idToKey));

    const wireSources: WireSource[] = [
      ...bucket.nodes.map((n) => ({ id: n.id, wires: n.wires ?? [] })),
      ...bucket.junctions.map((j) => ({ id: j.id, wires: j.wires })),
    ];
    const connections = buildBodyConnections(wireSources, idToKey);

    const tabPassthrough = pickPassthrough(tabNode, STRUCTURAL_TAB_FIELDS);
    const env = parseTabEnv(tabNode.env);

    tabs.push({
      id: authoringKey(tabNode),
      label: tabNode.label,
      ...(tabNode.disabled !== undefined ? { disabled: tabNode.disabled } : {}),
      ...(typeof tabNode.info === 'string' ? { info: tabNode.info } : {}),
      ...(tabNode.locked !== undefined ? { locked: tabNode.locked } : {}),
      ...(env !== undefined ? { env } : {}),
      nodes,
      connections,
      groups,
      comments,
      ...(junctions.length > 0 ? { junctions } : {}),
      ...(Object.keys(tabPassthrough).length > 0 ? { passthrough: tabPassthrough } : {}),
    });
  }

  const subflowDefs: SubflowDefSpec[] = [];
  for (const [defId, defNode] of subflowDefsById) {
    const bucket = buckets.get(defId) ?? emptyBucket();
    const idToKey = new Map<string, string>();
    for (const n of bucket.nodes) idToKey.set(n.id, authoringKey(n));
    for (const j of bucket.junctions) idToKey.set(j.id, authoringKey(j));
    const nodes: NodeSpec[] = bucket.nodes.map((n) => buildNodeSpec(n, idToKey, subflowDefIdToKey));
    const junctions: JunctionSpec[] = bucket.junctions.map((j) => buildJunctionSpec(j, idToKey));
    const wireSources: WireSource[] = [
      ...bucket.nodes.map((n) => ({ id: n.id, wires: n.wires ?? [] })),
      ...bucket.junctions.map((j) => ({ id: j.id, wires: j.wires })),
    ];
    const connections = buildBodyConnections(wireSources, idToKey);
    const passthrough = pickPassthrough(defNode, STRUCTURAL_SUBFLOW_DEF_FIELDS);
    subflowDefs.push({
      id: authoringKey(defNode),
      name: defNode.name,
      nodes,
      connections,
      ...(junctions.length > 0 ? { junctions } : {}),
      ...(Object.keys(passthrough).length > 0 ? { passthrough } : {}),
    });
  }

  return {
    tabs,
    ...(configNodes.length > 0
      ? { configNodes: configNodes.map((n) => buildConfigNodeSpec(n)) }
      : {}),
    ...(subflowDefs.length > 0 ? { subflowDefs } : {}),
  };
}

function parseTabEnv(env: TabNode['env']): TabEnvEntry[] | undefined {
  if (!Array.isArray(env)) return undefined;
  const out: TabEnvEntry[] = env.map((e) => {
    const entry: TabEnvEntry = {
      name: e.name,
      type: e.type,
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.ui !== undefined ? { ui: e.ui } : {}),
    };
    return entry;
  });
  return out;
}

function buildNodeSpec(
  node: RegularNode,
  idToKey: Map<string, string>,
  subflowDefIdToKey?: ReadonlyMap<string, string>,
): NodeSpec {
  const passthrough = pickPassthrough(node, STRUCTURAL_FIELDS);
  const groupKey = typeof node.g === 'string' ? idToKey.get(node.g) : undefined;
  // Reverse the compile-time rewrite: `subflow:<noderedId>` → `subflow:<authoringKey>`
  // when the def has an `_authoringKey`. Without this, a recompile from the
  // spec would emit two diverging type strings (instance vs def) and fail
  // subflow-ports validation.
  let nodeType = node.type;
  if (subflowDefIdToKey !== undefined && nodeType.startsWith(SUBFLOW_INSTANCE_PREFIX)) {
    const noderedId = nodeType.slice(SUBFLOW_INSTANCE_PREFIX.length);
    const key = subflowDefIdToKey.get(noderedId);
    if (key !== undefined) {
      nodeType = `${SUBFLOW_INSTANCE_PREFIX}${key}`;
    }
  }
  const spec: NodeSpec = {
    key: authoringKey(node),
    type: nodeType,
    ...(typeof node.name === 'string' ? { label: node.name } : {}),
    position: { x: node.x ?? 0, y: node.y ?? 0 },
    ...(groupKey !== undefined ? { groupKey } : {}),
    ...(Object.keys(passthrough).length > 0 ? { passthrough } : {}),
  };
  return spec;
}

function buildGroupSpec(node: GroupNode, idToKey: Map<string, string>): GroupSpec {
  const nodeKeys = node.nodes
    .map((id) => idToKey.get(id))
    .filter((x): x is string => typeof x === 'string');
  const passthrough = pickPassthrough(node, STRUCTURAL_GROUP_FIELDS);
  const position =
    typeof node.x === 'number' && typeof node.y === 'number' ? { x: node.x, y: node.y } : undefined;
  const size =
    typeof node.w === 'number' && typeof node.h === 'number' ? { w: node.w, h: node.h } : undefined;
  const parentKey = typeof node.g === 'string' ? idToKey.get(node.g) : undefined;
  // Carry `style` only when it is a non-null object that differs from the
  // default FlowOtter emits. `null` (Node-RED's normalization of an absent
  // style) and the canonical default both decompile to "no explicit style"
  // so compile re-emits the default and the round trip stays idempotent.
  const style =
    node.style !== undefined && node.style !== null && !isDefaultGroupStyle(node.style)
      ? node.style
      : undefined;
  return {
    key: authoringKey(node),
    name: node.name ?? '',
    nodeKeys,
    ...(position !== undefined ? { position } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(parentKey !== undefined ? { parentKey } : {}),
    ...(typeof node.info === 'string' ? { info: node.info } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(Object.keys(passthrough).length > 0 ? { passthrough } : {}),
  };
}

function isDefaultGroupStyle(style: unknown): boolean {
  if (typeof style !== 'object' || style === null) return false;
  const s = style as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_GROUP_STYLE);
  if (Object.keys(s).length !== keys.length) return false;
  return keys.every((k) => s[k] === (DEFAULT_GROUP_STYLE as Record<string, unknown>)[k]);
}

function buildCommentSpec(node: CommentNode, idToKey: Map<string, string>): CommentSpec {
  const groupKey = typeof node.g === 'string' ? idToKey.get(node.g) : undefined;
  const size =
    typeof node.w === 'number' && typeof node.h === 'number' ? { w: node.w, h: node.h } : undefined;
  return {
    key: authoringKey(node),
    text: node.name ?? '',
    position: { x: node.x, y: node.y },
    ...(size !== undefined ? { size } : {}),
    ...(typeof node.info === 'string' ? { info: node.info } : {}),
    ...(groupKey !== undefined ? { groupKey } : {}),
  };
}

function buildJunctionSpec(node: JunctionNode, idToKey: Map<string, string>): JunctionSpec {
  const groupKey = typeof node.g === 'string' ? idToKey.get(node.g) : undefined;
  return {
    key: authoringKey(node),
    position: { x: node.x, y: node.y },
    ...(typeof node.name === 'string' ? { name: node.name } : {}),
    ...(groupKey !== undefined ? { groupKey } : {}),
    ...(node.d !== undefined ? { disabled: node.d } : {}),
  };
}

function buildConfigNodeSpec(node: RegularNode): ConfigNodeSpec {
  const passthrough = pickPassthrough(node, STRUCTURAL_CONFIG_FIELDS);
  return {
    key: authoringKey(node),
    type: node.type,
    ...(typeof node.name === 'string' ? { label: node.name } : {}),
    ...(Object.keys(passthrough).length > 0 ? { passthrough } : {}),
  };
}
