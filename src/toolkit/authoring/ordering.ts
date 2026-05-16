import {
  isComment,
  isGroup,
  isJunction,
  isSubflowDef,
  isTab,
  type FlowsJsonNode,
  SUBFLOW_INSTANCE_PREFIX,
} from '../../shared/flows-json.js';

/**
 * Canonical sort for a `flows.json` array. Keyed by (z ?? "", typeRank, id).
 *
 * Tabs / subflow defs / config nodes have no `z`; they sort before any node
 * with a real `z` because empty string < any tab id. Within the same `z`,
 * groups come before regular/subflow-instance/junction nodes, then comments.
 */
export function typeRank(node: FlowsJsonNode): number {
  if (isTab(node)) return 0;
  if (isSubflowDef(node)) return 1;
  if (isGroup(node)) return 3;
  if (isComment(node)) return 5;
  if (isJunction(node)) return 4;
  if (typeof node.type === 'string' && node.type.startsWith(SUBFLOW_INSTANCE_PREFIX)) return 4;
  if ('x' in node && 'y' in node && 'wires' in node) return 4; // regular workspace node
  return 2; // config node
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function byCanonicalOrder(a: FlowsJsonNode, b: FlowsJsonNode): number {
  const aZ = (a as { z?: string }).z ?? '';
  const bZ = (b as { z?: string }).z ?? '';
  const zCmp = compareStrings(aZ, bZ);
  if (zCmp !== 0) return zCmp;
  const tCmp = typeRank(a) - typeRank(b);
  if (tCmp !== 0) return tCmp;
  return compareStrings(a.id, b.id);
}
