import {
  type CommentNode,
  type FlowsJson,
  type FlowsJsonNode,
  type GroupNode,
  type RegularNode,
  type SubflowDefNode,
  type TabNode,
  isComment,
  isConfigNode,
  isGroup,
  isRegularNode,
  isSubflowDef,
  isTab,
} from '../../shared/flows-json.js';

import { AUTHORING_KEY_FIELD } from './compile.js';
import type {
  AuthoringSpec,
  CommentSpec,
  ConfigNodeSpec,
  ConnectionSpec,
  GroupSpec,
  NodeSpec,
  SubflowDefSpec,
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
  AUTHORING_KEY_FIELD,
]);

const STRUCTURAL_TAB_FIELDS = new Set([
  'id',
  'type',
  'label',
  'disabled',
  'info',
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
}

function emptyBucket(): TabBuckets {
  return { nodes: [], groups: [], comments: [] };
}

function buildBodyConnections(
  bodyNodes: readonly RegularNode[],
  idToKey: Map<string, string>,
): ConnectionSpec[] {
  const connections: ConnectionSpec[] = [];
  for (const n of bodyNodes) {
    const fromKey = idToKey.get(n.id);
    if (!fromKey) continue;
    const wires = n.wires ?? [];
    for (let port = 0; port < wires.length; port++) {
      const targets = wires[port] ?? [];
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
    if (isConfigNode(node)) {
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

  const tabs: TabSpec[] = [];
  for (const [tabId, tabNode] of tabsById) {
    const bucket = buckets.get(tabId) ?? emptyBucket();

    const idToKey = new Map<string, string>();
    for (const n of bucket.nodes) idToKey.set(n.id, authoringKey(n));
    for (const g of bucket.groups) idToKey.set(g.id, authoringKey(g));
    for (const c of bucket.comments) idToKey.set(c.id, authoringKey(c));

    const nodes: NodeSpec[] = bucket.nodes.map((n) => buildNodeSpec(n, idToKey));
    const groups: GroupSpec[] = bucket.groups.map((g) => buildGroupSpec(g, idToKey));
    const comments: CommentSpec[] = bucket.comments.map((c) => buildCommentSpec(c, idToKey));
    const connections = buildBodyConnections(bucket.nodes, idToKey);

    const tabPassthrough = pickPassthrough(tabNode, STRUCTURAL_TAB_FIELDS);
    void tabPassthrough;

    tabs.push({
      id: authoringKey(tabNode),
      label: tabNode.label,
      ...(tabNode.disabled !== undefined ? { disabled: tabNode.disabled } : {}),
      ...(typeof tabNode.info === 'string' ? { info: tabNode.info } : {}),
      nodes,
      connections,
      groups,
      comments,
    });
  }

  const subflowDefs: SubflowDefSpec[] = [];
  for (const [defId, defNode] of subflowDefsById) {
    const bucket = buckets.get(defId) ?? emptyBucket();
    const idToKey = new Map<string, string>();
    for (const n of bucket.nodes) idToKey.set(n.id, authoringKey(n));
    const nodes: NodeSpec[] = bucket.nodes.map((n) => buildNodeSpec(n, idToKey));
    const connections = buildBodyConnections(bucket.nodes, idToKey);
    const passthrough = pickPassthrough(defNode, STRUCTURAL_SUBFLOW_DEF_FIELDS);
    subflowDefs.push({
      id: authoringKey(defNode),
      name: defNode.name,
      nodes,
      connections,
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

function buildNodeSpec(node: RegularNode, idToKey: Map<string, string>): NodeSpec {
  const passthrough = pickPassthrough(node, STRUCTURAL_FIELDS);
  const groupKey = typeof node.g === 'string' ? idToKey.get(node.g) : undefined;
  const spec: NodeSpec = {
    key: authoringKey(node),
    type: node.type,
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
  const style = pickPassthrough(node, STRUCTURAL_GROUP_FIELDS);
  return {
    key: authoringKey(node),
    name: node.name ?? '',
    nodeKeys,
    ...(node.style !== undefined
      ? { style: node.style }
      : Object.keys(style).length > 0
        ? { style }
        : {}),
  };
}

function buildCommentSpec(node: CommentNode, idToKey: Map<string, string>): CommentSpec {
  const groupKey = typeof node.g === 'string' ? idToKey.get(node.g) : undefined;
  return {
    key: authoringKey(node),
    text: node.name ?? '',
    position: { x: node.x, y: node.y },
    ...(typeof node.info === 'string' ? { info: node.info } : {}),
    ...(groupKey !== undefined ? { groupKey } : {}),
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
