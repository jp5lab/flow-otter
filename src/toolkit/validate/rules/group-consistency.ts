import { isGroup, type FlowsJson, type GroupNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'group-consistency';

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const groups: GroupNode[] = flows.filter(isGroup);

  // Map each node id → declared `g` field if present.
  const nodeGroupRef = new Map<string, string | undefined>();
  for (const node of flows) {
    if (isGroup(node)) continue;
    const g = (node as { g?: string }).g;
    nodeGroupRef.set(node.id, g);
  }

  // Map each node id → group ids that claim it via `nodes:[]`.
  const claimedBy = new Map<string, string[]>();
  for (const group of groups) {
    for (const memberId of group.nodes) {
      const list = claimedBy.get(memberId) ?? [];
      list.push(group.id);
      claimedBy.set(memberId, list);
    }
  }

  // 1. Every node listed in `group.nodes` must have `g === group.id`.
  for (const group of groups) {
    for (const memberId of group.nodes) {
      const declared = nodeGroupRef.get(memberId);
      if (declared === undefined) {
        diagnostics.push({
          severity: 'error',
          rule: RULE,
          message: `Group '${group.id}' lists node '${memberId}' which does not exist.`,
          nodeId: group.id,
          tabId: group.z,
          context: { groupId: group.id, memberId },
        });
      } else if (declared !== group.id) {
        diagnostics.push({
          severity: 'error',
          rule: RULE,
          message: `Node '${memberId}' is listed in group '${group.id}' but its g='${declared ?? ''}'.`,
          nodeId: memberId,
          tabId: group.z,
          context: { groupId: group.id, declared },
        });
      }
    }
  }

  // 2. Every node with `g` set must appear in that group's `nodes`.
  for (const [nodeId, g] of nodeGroupRef) {
    if (g === undefined) continue;
    const owners = claimedBy.get(nodeId) ?? [];
    if (!owners.includes(g)) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Node '${nodeId}' has g='${g}' but group '${g}' does not list it.`,
        nodeId,
        context: { g, owners },
      });
    }
  }

  // 3. A node should not be claimed by more than one group.
  for (const [nodeId, owners] of claimedBy) {
    if (owners.length > 1) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Node '${nodeId}' is claimed by ${owners.length} groups: ${owners.join(', ')}.`,
        nodeId,
        context: { owners },
      });
    }
  }

  return diagnostics;
}
