/**
 * Layout entry points. The default/auto path uses the two-level ELK engine:
 * sections and semantic lanes are partitioned first, then each lane is laid
 * out with compound groups and fixed-order ports. Dagre remains available as
 * an explicit legacy fallback for simple chains and older callers.
 *
 * This is toolkit-layer only; no MCP layout tool is exposed here.
 */

import { compile } from '../authoring/compile.js';
import { decompile } from '../authoring/decompile.js';
import type { AuthoringSpec, TabSpec } from '../authoring/types.js';
import type { FlowsJson, FlowsJsonNode } from '../../shared/flows-json.js';

import { layoutFlowsWithDagre, type LayoutOpts as DagreOpts } from './dagre.js';
import { layoutTabWithElkCore, resolveElkLayoutOpts, type ElkLayoutOpts } from './elk.js';
import { layoutTabWithTwoLevel } from './two-level.js';

export type LayoutEngine = 'auto' | 'dagre' | 'elk';

export interface LayoutFlowsOpts extends DagreOpts, ElkLayoutOpts {
  /** Engine to use. 'auto' picks by flow shape; default is 'auto'. */
  engine?: LayoutEngine;
}

export interface LayoutTabsOpts extends ElkLayoutOpts {
  /** Optional tab id scope. Unscoped tabs are returned untouched. */
  tabIds?: readonly string[];
}

export async function layoutFlows(
  spec: AuthoringSpec,
  opts: LayoutFlowsOpts = {},
): Promise<AuthoringSpec> {
  const engine: LayoutEngine = opts.engine ?? 'auto';
  if (engine === 'auto' || engine === 'elk') return layoutTabs(spec, opts);
  // dagre is synchronous; wrap in Promise.resolve so the union return type stays uniform.
  return Promise.resolve(layoutFlowsWithDagre(spec, opts));
}

function shouldLayoutTab(tab: TabSpec, scopedTabIds: ReadonlySet<string> | undefined): boolean {
  return scopedTabIds === undefined || scopedTabIds.has(tab.id);
}

const LAYOUT_GEOMETRY_FIELDS = ['x', 'y', 'w', 'h'] as const;

function tabScopeOf(node: FlowsJsonNode): string | undefined {
  if (node.type === 'tab') return node.id;
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function isInScope(node: FlowsJsonNode, scopedTabIds: ReadonlySet<string> | undefined): boolean {
  if (scopedTabIds === undefined) return true;
  const tabId = tabScopeOf(node);
  return tabId !== undefined && scopedTabIds.has(tabId);
}

function mergeLayoutGeometry(prior: FlowsJsonNode, compiled: FlowsJsonNode): FlowsJsonNode {
  const out = { ...prior } as Record<string, unknown>;
  const compiledRecord = compiled as Record<string, unknown>;
  for (const field of LAYOUT_GEOMETRY_FIELDS) {
    if (field in compiledRecord) out[field] = compiledRecord[field];
    else delete out[field];
  }
  return out as FlowsJsonNode;
}

export async function layoutTabs(
  spec: AuthoringSpec,
  opts: LayoutTabsOpts = {},
): Promise<AuthoringSpec> {
  const resolved = resolveElkLayoutOpts(opts);
  const scopedTabIds = opts.tabIds === undefined ? undefined : new Set(opts.tabIds);
  const tabs: TabSpec[] = [];
  for (const tab of spec.tabs) {
    tabs.push(
      shouldLayoutTab(tab, scopedTabIds)
        ? await layoutTabWithTwoLevel(tab, resolved, layoutTabWithElkCore)
        : tab,
    );
  }
  return { ...spec, tabs };
}

export async function layoutFlowsJson(
  flows: FlowsJson,
  opts: LayoutTabsOpts = {},
): Promise<FlowsJson> {
  const scopedTabIds = opts.tabIds === undefined ? undefined : new Set(opts.tabIds);
  const spec = decompile(flows);
  const laidOut = await layoutTabs(spec, opts);
  const compiled = compile(laidOut, { prior: flows }).flows;
  const compiledById = new Map(compiled.map((node) => [node.id, node]));
  const priorIds = new Set(flows.map((node) => node.id));
  return [
    ...flows.map((node) => {
      if (!isInScope(node, scopedTabIds)) return node;
      const compiledNode = compiledById.get(node.id);
      return compiledNode === undefined ? node : mergeLayoutGeometry(node, compiledNode);
    }),
    ...compiled.filter((node) => !priorIds.has(node.id) && isInScope(node, scopedTabIds)),
  ];
}

export { layoutFlowsWithDagre } from './dagre.js';
export { layoutFlowsWithElk } from './elk.js';
export {
  flowEdges,
  flowMetrics,
  flowPositions,
  horizontalOverlap,
  layoutObjectBounds,
  rectContains,
  rectsDisjoint,
  stripLayoutGeometry,
  stripPositions,
  tabBoundingExtent,
  tabContentBounds,
  tabLayoutObjects,
  type FlowMetricEdge,
  type FlowMetricExtent,
  type FlowMetricObject,
  type FlowMetricPosition,
  type FlowMetricRect,
  type FlowMetrics,
} from './layout-metrics.js';
export {
  deriveFlowsJsonSections,
  deriveTabSpecSections,
  type Section,
  type SectionDerivation,
} from './sections.js';
export {
  stackVertical,
  translateRect,
  unionRect,
  unionRects,
  type LayoutRect,
  type StackItem,
  type StackedItem,
} from './stack.js';
export { layoutTabWithTwoLevel } from './two-level.js';
