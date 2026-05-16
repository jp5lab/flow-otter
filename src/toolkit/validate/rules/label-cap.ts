import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'label-cap';
export const DEFAULT_LABEL_CAP = 24;

interface Options {
  cap?: number;
}

function nodeLabel(node: FlowsJsonNode): string | undefined {
  if ('label' in node && typeof node.label === 'string') return node.label;
  if ('name' in node && typeof node.name === 'string') return node.name;
  return undefined;
}

export function check(flows: FlowsJson, opts: Options = {}): Diagnostic[] {
  const cap = opts.cap ?? DEFAULT_LABEL_CAP;
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    if (node.type === 'comment') continue; // sticky-note text legitimately exceeds cap
    const label = nodeLabel(node);
    if (label === undefined) continue;
    if (label.length > cap) {
      diagnostics.push({
        severity: 'warning',
        rule: RULE,
        message: `Label '${label}' exceeds ${cap}-character cap (${label.length}).`,
        nodeId: node.id,
        ...(typeof (node as { z?: string }).z === 'string'
          ? { tabId: (node as { z: string }).z }
          : {}),
        context: { length: label.length, cap },
      });
    }
  }

  return diagnostics;
}
