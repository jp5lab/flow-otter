import { isRegularNode, isTab, type FlowsJson } from '../../../shared/flows-json.js';
import type { AuthoringSpec, NodeSpec } from '../../../toolkit/authoring/types.js';

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
