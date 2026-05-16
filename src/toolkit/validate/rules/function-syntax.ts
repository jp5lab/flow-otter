import type { FlowsJson } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

import { parseFunctionNodeJs } from './_function-ast.js';

export const RULE = 'function-syntax';

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    if (node.type !== 'function') continue;
    const code = (node as { func?: unknown }).func;
    if (typeof code !== 'string' || code.length === 0) continue;

    const result = parseFunctionNodeJs(code);
    if (result.ok) continue;

    const z = (node as { z?: string }).z;
    diagnostics.push({
      severity: 'error',
      rule: RULE,
      message: `Function node '${node.id}' has invalid JS: ${result.message}`,
      nodeId: node.id,
      ...(typeof z === 'string' ? { tabId: z } : {}),
      context: {
        ...(result.line !== undefined ? { line: result.line } : {}),
        ...(result.column !== undefined ? { column: result.column } : {}),
        parserMessage: result.message,
      },
    });
  }

  return diagnostics;
}
