/**
 * Unbounded ui-chart in append mode — operator-UI anti-pattern. Chart
 * history grows without bound, leading to unbounded memory growth in the
 * operator's browser. Operators rarely need >24h in-browser, and pruning
 * happens server-side anyway.
 *
 * Triggers on Dashboard 2.0 ui-chart nodes where `action === 'append'`
 * (the default) AND no `xAxisLimit` is set on either the node passthrough
 * or the canonical fields.
 */

import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'unbounded-chart-append';

function tabIdOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const node of flows) {
    if (node.type !== 'ui-chart') continue;
    const n = node as Record<string, unknown>;
    const action = typeof n['action'] === 'string' ? n['action'] : 'append';
    if (action !== 'append') continue;
    const limit = n['xAxisLimit'];
    if (typeof limit === 'number' && limit > 0) continue;
    out.push({
      severity: 'warning',
      rule: RULE,
      message: `Dashboard 2.0 ui-chart '${node.id}' uses action:'append' without xAxisLimit. Set xAxisLimit (or switch to action:'replace') to prevent unbounded data growth in the client. Operator dashboards rarely need >24h of in-browser history.`,
      nodeId: node.id,
      ...(tabIdOf(node) !== undefined ? { tabId: tabIdOf(node)! } : {}),
      context: {
        action,
      },
    });
  }
  return out;
}
