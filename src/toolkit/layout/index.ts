/**
 * Layout entry point. Auto-selects between dagre and elkjs based on the
 * shape of the flow:
 *
 *   - ELK when the flow has groups, multi-output nodes (≥4 outputs on any
 *     node), or ≥30 total nodes — i.e., past dagre's sweet spot.
 *   - dagre otherwise — smaller bundle, synchronous, no startup cost.
 *
 * The agent can override with `engine: 'dagre' | 'elk'` if it wants a
 * specific engine. `engine: 'auto'` (the default) runs the heuristic.
 *
 * Per FlowOtter Decision 1, Item 8 of the v1.3.0 plan: small flows stay
 * fast with dagre; flows that benefit from port/group awareness escalate
 * to ELK.
 */

import type { AuthoringSpec, GroupSpec } from '../authoring/types.js';

import { layoutFlowsWithDagre, type LayoutOpts as DagreOpts } from './dagre.js';
import { layoutFlowsWithElk, type ElkLayoutOpts } from './elk.js';

export type LayoutEngine = 'auto' | 'dagre' | 'elk';

export interface LayoutFlowsOpts extends DagreOpts, ElkLayoutOpts {
  /** Engine to use. 'auto' picks by flow shape; default is 'auto'. */
  engine?: LayoutEngine;
}

/**
 * Heuristic for auto-engine selection. Mirrors the layout_strategy
 * decision in plan_flow so plan + layout agree.
 */
function autoEngine(spec: AuthoringSpec): 'dagre' | 'elk' {
  let totalNodes = 0;
  let hasGroups = false;
  let hasManyOutputs = false;
  for (const tab of spec.tabs) {
    totalNodes += tab.nodes.length;
    if (tab.groups.length > 0) hasGroups = true;
    for (const n of tab.nodes) {
      const passthrough = n.passthrough as { outputs?: unknown } | undefined;
      const outputs = typeof passthrough?.outputs === 'number' ? passthrough.outputs : 0;
      if (outputs >= 4) hasManyOutputs = true;
    }
  }
  void ({} as GroupSpec); // silence unused-import lint while still type-anchoring GroupSpec via dagre.ts
  if (hasGroups || hasManyOutputs || totalNodes >= 30) return 'elk';
  return 'dagre';
}

export async function layoutFlows(
  spec: AuthoringSpec,
  opts: LayoutFlowsOpts = {},
): Promise<AuthoringSpec> {
  const engine: LayoutEngine = opts.engine ?? 'auto';
  const resolved: 'dagre' | 'elk' = engine === 'auto' ? autoEngine(spec) : engine;
  if (resolved === 'elk') return layoutFlowsWithElk(spec, opts);
  // dagre is synchronous; wrap in Promise.resolve so the union return type stays uniform.
  return Promise.resolve(layoutFlowsWithDagre(spec, opts));
}

export { layoutFlowsWithDagre } from './dagre.js';
export { layoutFlowsWithElk } from './elk.js';
