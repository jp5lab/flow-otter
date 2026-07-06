import {
  isComment,
  isJunction,
  isRegularNode,
  isTab,
  type FlowsJson,
} from '../../../shared/flows-json.js';
import type {
  AuthoringSpec,
  CommentSpec,
  JunctionSpec,
  NodeSpec,
} from '../../../toolkit/authoring/types.js';

export const NODE_RED_NODE_ID_RE = /^[0-9a-f]{16}$/;

export interface NodeKeyResolutionGuidance {
  readonly field: string;
  readonly input: string;
  readonly resolvedKey: string;
}

export type NodeKeyResolution =
  | {
      readonly ok: true;
      readonly key: string;
      readonly node: NodeSpec;
      readonly resolvedFrom: 'key' | 'id';
      readonly guidance?: NodeKeyResolutionGuidance;
    }
  | {
      readonly ok: false;
      readonly reason: 'tab-not-found' | 'wrong-tab-id' | 'node-id-not-found' | 'key-not-found';
      readonly message: string;
    };

export type CanvasObjectResolution =
  | {
      readonly ok: true;
      readonly key: string;
      readonly kind: 'node' | 'junction' | 'comment';
      readonly object: NodeSpec | JunctionSpec | CommentSpec;
      readonly resolvedFrom: 'key' | 'id';
      readonly guidance?: NodeKeyResolutionGuidance;
    }
  | {
      readonly ok: false;
      readonly reason: 'tab-not-found' | 'wrong-tab-id' | 'node-id-not-found' | 'key-not-found';
      readonly message: string;
    };

export interface ResolveNodeKeyOnTabOpts {
  readonly spec: AuthoringSpec;
  readonly priorFlows: FlowsJson;
  readonly tabId: string;
  readonly value: string;
  readonly field: string;
  readonly subject?: string;
  readonly notFoundSuffix?: string;
}

const AUTHORING_KEY_GUIDANCE =
  'Author tools take node authoring keys; get_flow shows both id and _authoringKey.';

const NODE_KEY_RESOLUTION_GUIDANCE = Symbol('flow-otter.node-key-resolution-guidance');

export function resolveNodeKeyOnTab(opts: ResolveNodeKeyOnTabOpts): NodeKeyResolution {
  const subject = opts.subject ?? 'Node';
  const tab = opts.spec.tabs.find((t) => t.id === opts.tabId);
  if (tab === undefined) {
    return {
      ok: false,
      reason: 'tab-not-found',
      message: `Tab '${opts.tabId}' not found in spec.`,
    };
  }

  const keyMatch = tab.nodes.find((n) => n.key === opts.value);
  if (keyMatch !== undefined) {
    return { ok: true, key: opts.value, node: keyMatch, resolvedFrom: 'key' };
  }

  const idMatch = findRegularNodeIdMatch(opts.spec, opts.priorFlows, opts.value);
  if (idMatch !== undefined) {
    if (idMatch.tabId === opts.tabId) {
      const node = tab.nodes.find((n) => n.key === idMatch.key);
      if (node !== undefined) {
        return {
          ok: true,
          key: idMatch.key,
          node,
          resolvedFrom: 'id',
          guidance: {
            field: opts.field,
            input: opts.value,
            resolvedKey: idMatch.key,
          },
        };
      }
    }
    return {
      ok: false,
      reason: 'wrong-tab-id',
      message:
        `${subject} '${opts.value}' is a Node-RED node id on tab '${idMatch.tabId}', not tab '${opts.tabId}'. ` +
        AUTHORING_KEY_GUIDANCE,
    };
  }

  if (NODE_RED_NODE_ID_RE.test(opts.value)) {
    return {
      ok: false,
      reason: 'node-id-not-found',
      message: `${subject} '${opts.value}' looks like a Node-RED node id, but no node with that id was found. ${AUTHORING_KEY_GUIDANCE}`,
    };
  }

  return {
    ok: false,
    reason: 'key-not-found',
    message: `${subject} '${opts.value}' not found on tab '${opts.tabId}'${opts.notFoundSuffix ?? ''}.`,
  };
}

export function resolveCanvasObjectKeyOnTab(opts: ResolveNodeKeyOnTabOpts): CanvasObjectResolution {
  const subject = opts.subject ?? 'Node, junction, or comment';
  const tab = opts.spec.tabs.find((t) => t.id === opts.tabId);
  if (tab === undefined) {
    return {
      ok: false,
      reason: 'tab-not-found',
      message: `Tab '${opts.tabId}' not found in spec.`,
    };
  }

  const node = tab.nodes.find((n) => n.key === opts.value);
  if (node !== undefined) {
    return { ok: true, key: opts.value, kind: 'node', object: node, resolvedFrom: 'key' };
  }
  const junction = tab.junctions?.find((j) => j.key === opts.value);
  if (junction !== undefined) {
    return {
      ok: true,
      key: opts.value,
      kind: 'junction',
      object: junction,
      resolvedFrom: 'key',
    };
  }
  const comment = tab.comments.find((c) => c.key === opts.value);
  if (comment !== undefined) {
    return { ok: true, key: opts.value, kind: 'comment', object: comment, resolvedFrom: 'key' };
  }

  const idMatch = findCanvasObjectIdMatch(opts.spec, opts.priorFlows, opts.value);
  if (idMatch !== undefined) {
    if (idMatch.tabId === opts.tabId) {
      const object = findCanvasObjectInTab(tab, idMatch.kind, idMatch.key);
      if (object !== undefined) {
        return {
          ok: true,
          key: idMatch.key,
          kind: idMatch.kind,
          object,
          resolvedFrom: 'id',
          guidance: {
            field: opts.field,
            input: opts.value,
            resolvedKey: idMatch.key,
          },
        };
      }
    }
    return {
      ok: false,
      reason: 'wrong-tab-id',
      message:
        `${subject} '${opts.value}' is a Node-RED node id on tab '${idMatch.tabId}', not tab '${opts.tabId}'. ` +
        AUTHORING_KEY_GUIDANCE,
    };
  }

  if (NODE_RED_NODE_ID_RE.test(opts.value)) {
    return {
      ok: false,
      reason: 'node-id-not-found',
      message: `${subject} '${opts.value}' looks like a Node-RED node id, but no node, junction, or comment with that id was found. ${AUTHORING_KEY_GUIDANCE}`,
    };
  }

  return {
    ok: false,
    reason: 'key-not-found',
    message: `${subject} '${opts.value}' not found on tab '${opts.tabId}'${opts.notFoundSuffix ?? ''}.`,
  };
}

export function attachNodeKeyResolutionGuidance<T extends object>(
  output: T,
  resolutions: readonly NodeKeyResolutionGuidance[],
): T {
  if (resolutions.length === 0) return output;
  Object.defineProperty(output, NODE_KEY_RESOLUTION_GUIDANCE, {
    value: [...resolutions],
    enumerable: false,
    configurable: false,
  });
  return output;
}

export function getNodeKeyResolutionGuidance(
  result: unknown,
): readonly NodeKeyResolutionGuidance[] {
  if (typeof result !== 'object' || result === null) return [];
  const value = (result as Record<symbol, unknown>)[NODE_KEY_RESOLUTION_GUIDANCE];
  if (!Array.isArray(value)) return [];
  return value.filter(isNodeKeyResolutionGuidance);
}

function isNodeKeyResolutionGuidance(value: unknown): value is NodeKeyResolutionGuidance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<NodeKeyResolutionGuidance>;
  return (
    typeof v.field === 'string' && typeof v.input === 'string' && typeof v.resolvedKey === 'string'
  );
}

interface PriorNodeMatch {
  readonly key: string;
  readonly tabId: string;
}

interface PriorCanvasObjectMatch extends PriorNodeMatch {
  readonly kind: 'node' | 'junction' | 'comment';
}

function findRegularNodeIdMatch(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  nodeRedId: string,
): PriorNodeMatch | undefined {
  for (const flowNode of priorFlows) {
    if (flowNode.id !== nodeRedId || !isRegularNode(flowNode)) continue;
    const nodeRedTabId = typeof flowNode.z === 'string' ? flowNode.z : undefined;
    if (nodeRedTabId === undefined) continue;
    const tabId = authoringTabIdForNodeRedTabId(priorFlows, nodeRedTabId);
    if (tabId === undefined) continue;
    const key = authoringKeyForFlowNode(flowNode);
    const specTab = spec.tabs.find((t) => t.id === tabId);
    if (specTab?.nodes.some((n) => n.key === key) !== true) continue;
    return { key, tabId };
  }
  return undefined;
}

function findCanvasObjectIdMatch(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  nodeRedId: string,
): PriorCanvasObjectMatch | undefined {
  for (const flowNode of priorFlows) {
    if (flowNode.id !== nodeRedId) continue;
    const kind = canvasKindForFlowNode(flowNode);
    if (kind === undefined) continue;
    const z = (flowNode as { z?: unknown }).z;
    const nodeRedTabId = typeof z === 'string' ? z : undefined;
    if (nodeRedTabId === undefined) continue;
    const tabId = authoringTabIdForNodeRedTabId(priorFlows, nodeRedTabId);
    if (tabId === undefined) continue;
    const key = authoringKeyForFlowNode(flowNode);
    const specTab = spec.tabs.find((t) => t.id === tabId);
    if (specTab === undefined) continue;
    if (findCanvasObjectInTab(specTab, kind, key) === undefined) continue;
    return { key, tabId, kind };
  }
  return undefined;
}

function canvasKindForFlowNode(
  node: FlowsJson[number],
): 'node' | 'junction' | 'comment' | undefined {
  if (isRegularNode(node)) return 'node';
  if (isJunction(node)) return 'junction';
  if (isComment(node)) return 'comment';
  return undefined;
}

function findCanvasObjectInTab(
  tab: AuthoringSpec['tabs'][number],
  kind: 'node' | 'junction' | 'comment',
  key: string,
): NodeSpec | JunctionSpec | CommentSpec | undefined {
  if (kind === 'node') return tab.nodes.find((n) => n.key === key);
  if (kind === 'junction') return tab.junctions?.find((j) => j.key === key);
  return tab.comments.find((c) => c.key === key);
}

function authoringTabIdForNodeRedTabId(
  priorFlows: FlowsJson,
  nodeRedTabId: string,
): string | undefined {
  const tab = priorFlows.find((n) => isTab(n) && n.id === nodeRedTabId);
  if (tab === undefined) return undefined;
  return authoringKeyForFlowNode(tab);
}

function authoringKeyForFlowNode(node: FlowsJson[number]): string {
  const ext = (node as Record<string, unknown>)['_authoringKey'];
  return typeof ext === 'string' ? ext : node.id;
}
