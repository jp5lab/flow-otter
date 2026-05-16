import { isGroup, isTab, type FlowsJson } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'tab-divergence';

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const tabsByLabel = new Map<string, string[]>();
  for (const node of flows) {
    if (!isTab(node)) continue;
    const key = node.label.toLowerCase();
    const ids = tabsByLabel.get(key) ?? [];
    ids.push(node.id);
    tabsByLabel.set(key, ids);
  }
  for (const [label, ids] of tabsByLabel) {
    if (ids.length > 1) {
      for (const id of ids) {
        diagnostics.push({
          severity: 'warning',
          rule: RULE,
          message: `Tab '${id}' shares label '${label}' with ${ids.length - 1} other tab(s): ${ids.filter((x) => x !== id).join(', ')}.`,
          nodeId: id,
          tabId: id,
          context: { label, peers: ids.filter((x) => x !== id) },
        });
      }
    }
  }

  const nodeTabById = new Map<string, string | undefined>();
  for (const node of flows) {
    const z = (node as { z?: unknown }).z;
    nodeTabById.set(node.id, typeof z === 'string' ? z : undefined);
  }

  for (const node of flows) {
    if (!isGroup(node)) continue;
    for (const memberId of node.nodes) {
      const memberTab = nodeTabById.get(memberId);
      if (memberTab === undefined) continue;
      if (memberTab !== node.z) {
        diagnostics.push({
          severity: 'error',
          rule: RULE,
          message: `Group '${node.id}' on tab '${node.z}' lists node '${memberId}' which is on tab '${memberTab}'.`,
          nodeId: memberId,
          tabId: memberTab,
          context: { groupId: node.id, groupTab: node.z, memberTab },
        });
      }
    }
  }

  return diagnostics;
}
