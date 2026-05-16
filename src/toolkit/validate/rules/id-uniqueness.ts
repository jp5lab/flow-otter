import type { FlowsJson } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'id-uniqueness';

export function check(flows: FlowsJson): Diagnostic[] {
  const seen = new Map<string, number>();
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    const count = (seen.get(node.id) ?? 0) + 1;
    seen.set(node.id, count);
  }

  for (const [id, count] of seen) {
    if (count > 1) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Duplicate node id '${id}' (${count} occurrences).`,
        nodeId: id,
        context: { count },
      });
    }
  }

  return diagnostics;
}
