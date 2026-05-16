import {
  isComment,
  isGroup,
  isRegularNode,
  isSubflowDef,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
} from '../../shared/flows-json.js';
import { byCanonicalOrder } from '../authoring/ordering.js';

/**
 * Returns a normalized copy of `flows` suitable for semantic diffing.
 *
 * Sorts the array, sorts each `wires[i]` target list, dedupes wire targets,
 * and strips fields that are computed-deterministic and shouldn't drive a diff
 * (e.g. nothing currently in this category, but the seam exists).
 *
 * Pure: never mutates `flows`.
 */
export function normalize(flows: FlowsJson): FlowsJson {
  const cloned: FlowsJsonNode[] = flows.map((n) => normalizeNode(n));
  cloned.sort(byCanonicalOrder);
  return cloned;
}

function normalizeNode(node: FlowsJsonNode): FlowsJsonNode {
  if (isTab(node) || isSubflowDef(node) || isGroup(node) || isComment(node)) {
    return { ...(node as object) } as FlowsJsonNode;
  }
  if (isRegularNode(node)) {
    const wires = (node.wires ?? []).map((arr) => Array.from(new Set(arr)).slice().sort());
    return { ...(node as object), wires } as FlowsJsonNode;
  }
  return { ...(node as object) } as FlowsJsonNode;
}
