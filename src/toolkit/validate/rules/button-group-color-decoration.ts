/**
 * Color-as-decoration anti-pattern on ui-button-group: when every option
 * uses a different color and there's no clear severity ordering, color is
 * acting as decoration rather than signal. ISA-101 reserves color for
 * meaning — if all four mode buttons use different colors with no severity
 * mapping, the operator has to memorize the palette rather than read it.
 *
 * Triggers when ≥3 options each declare a unique `color` value.
 * Severity: info (lowest) — the rule is a nudge, not a hard violation.
 */

import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'button-group-color-decoration';

function tabIdOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const node of flows) {
    if (node.type !== 'ui-button-group') continue;
    const n = node as Record<string, unknown>;
    const options = n['options'];
    if (!Array.isArray(options) || options.length < 3) continue;

    const colors: string[] = [];
    for (const opt of options) {
      if (opt === null || typeof opt !== 'object') continue;
      const c = (opt as Record<string, unknown>)['color'];
      if (typeof c === 'string' && c.length > 0) colors.push(c);
    }

    if (colors.length < 3) continue;
    const unique = new Set(colors);
    if (unique.size !== colors.length) continue;

    out.push({
      severity: 'info',
      rule: RULE,
      message: `Dashboard 2.0 ui-button-group '${node.id}' has ${colors.length} options each with a different color. ISA-101 reserves color for severity/signal — if the colors don't map to a severity ordering, prefer a neutral palette and reserve color for alarm states.`,
      nodeId: node.id,
      ...(tabIdOf(node) !== undefined ? { tabId: tabIdOf(node)! } : {}),
      context: { unique_colors: unique.size, total_options: options.length },
    });
  }
  return out;
}
