import { isJunction, isRegularNode, type FlowsJson } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'wire-targets';

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const idSet = new Set(flows.map((n) => n.id));

  for (const node of flows) {
    if (!isRegularNode(node) && !isJunction(node)) continue;
    const wires = node.wires ?? [];
    for (let port = 0; port < wires.length; port++) {
      const targets = wires[port] ?? [];
      for (const targetId of targets) {
        if (!idSet.has(targetId)) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `Wire from '${node.id}' port ${port} references missing node '${targetId}'.`,
            nodeId: node.id,
            ...(typeof node.z === 'string' ? { tabId: node.z } : {}),
            context: { port, targetId },
          });
        }
      }
    }
  }

  return diagnostics;
}
