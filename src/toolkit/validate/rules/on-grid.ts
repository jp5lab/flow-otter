import { hasCanvasPosition, type FlowsJson } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'on-grid';
export const DEFAULT_GRID = 20;

interface Options {
  grid?: number;
}

export function check(flows: FlowsJson, opts: Options = {}): Diagnostic[] {
  const grid = opts.grid ?? DEFAULT_GRID;
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    if (!hasCanvasPosition(node)) continue;
    const x = node.x;
    const y = node.y;
    const z = (node as { z?: string }).z;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Position (${String(x)}, ${String(y)}) is not finite.`,
        nodeId: node.id,
        ...(typeof z === 'string' ? { tabId: z } : {}),
        context: { x, y },
      });
      continue;
    }
    if (x % grid !== 0 || y % grid !== 0) {
      diagnostics.push({
        severity: 'warning',
        rule: RULE,
        message: `Position (${x}, ${y}) is not on the ${grid}px grid.`,
        nodeId: node.id,
        ...(typeof z === 'string' ? { tabId: z } : {}),
        context: { x, y, grid },
      });
    }
  }

  return diagnostics;
}
