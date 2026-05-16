import {
  isSubflowDef,
  isSubflowInstance,
  SUBFLOW_INSTANCE_PREFIX,
  type FlowsJson,
  type SubflowDefNode,
} from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'subflow-ports';

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const defsById = new Map<string, SubflowDefNode>();
  for (const node of flows) {
    if (isSubflowDef(node)) defsById.set(node.id, node);
  }

  for (const node of flows) {
    if (!isSubflowInstance(node)) continue;
    const defId = node.type.slice(SUBFLOW_INSTANCE_PREFIX.length);
    const def = defsById.get(defId);
    const z = (node as { z?: string }).z;

    if (!def) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Subflow instance '${node.id}' references missing subflow definition '${defId}'.`,
        nodeId: node.id,
        ...(typeof z === 'string' ? { tabId: z } : {}),
        context: { defId },
      });
      continue;
    }

    const expectedOut = Array.isArray(def.out) ? def.out.length : 0;
    const wires = (node as { wires?: unknown[] }).wires;
    const actualOut = Array.isArray(wires) ? wires.length : 0;
    if (actualOut !== expectedOut) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Subflow instance '${node.id}' has ${actualOut} output wire arrays but def '${defId}' declares ${expectedOut}.`,
        nodeId: node.id,
        ...(typeof z === 'string' ? { tabId: z } : {}),
        context: { defId, actualOut, expectedOut },
      });
    }
  }

  return diagnostics;
}
