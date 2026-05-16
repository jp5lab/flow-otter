import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'dashboard-2-mixed-versions';

function isV1Type(type: string): boolean {
  return type.startsWith('ui_');
}

function isV2Type(type: string): boolean {
  return type.startsWith('ui-');
}

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const v1: FlowsJsonNode[] = [];
  const v2: FlowsJsonNode[] = [];

  for (const node of flows) {
    if (typeof node.type !== 'string') continue;
    if (isV1Type(node.type)) v1.push(node);
    else if (isV2Type(node.type)) v2.push(node);
  }

  if (v1.length === 0 || v2.length === 0) return [];

  const diagnostics: Diagnostic[] = [];
  const v1Types = Array.from(new Set(v1.map((n) => n.type))).sort();
  const v2Types = Array.from(new Set(v2.map((n) => n.type))).sort();

  for (const node of v1) {
    const z = tabId(node);
    diagnostics.push({
      severity: 'warning',
      rule: RULE,
      message: `Dashboard 1.0 node '${node.id}' (${node.type}) coexists with Dashboard 2.0 nodes. Consider migrating with @flowfuse/node-red-dashboard-2-migration.`,
      nodeId: node.id,
      ...(z !== undefined ? { tabId: z } : {}),
      context: { version: 'v1', v1Types, v2Types },
    });
  }

  return diagnostics;
}
