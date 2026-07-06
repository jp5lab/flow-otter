import dagre from '@dagrejs/dagre';

import type { AuthoringSpec, TabSpec } from '../authoring/types.js';

import {
  applyPositions,
  dimensionsForJunction,
  dimensionsForNode,
  type LayoutDiagnosticHandler,
  type LayoutParticipantDimensions,
} from './apply-positions.js';
import { defaultBounds, type Bounds } from './bounds.js';
import { DEFAULT_GRID } from './grid.js';

export interface LayoutOpts {
  rankdir?: 'LR' | 'TB';
  nodesep?: number;
  edgesep?: number;
  ranksep?: number;
  grid?: number;
  bounds?: Bounds;
  onDiagnostic?: LayoutDiagnosticHandler;
}

const LAYOUT_DEFAULTS = {
  rankdir: 'LR' as const,
  nodesep: 50,
  edgesep: 10,
  ranksep: 80,
};

interface ResolvedOpts {
  rankdir: 'LR' | 'TB';
  nodesep: number;
  edgesep: number;
  ranksep: number;
  grid: number;
  bounds: Bounds;
  onDiagnostic?: LayoutDiagnosticHandler;
}

function layoutTab(tab: TabSpec, opts: ResolvedOpts): TabSpec {
  const sortedNodes = [...tab.nodes].sort((a, b) => a.key.localeCompare(b.key));
  const sortedJunctions = [...(tab.junctions ?? [])].sort((a, b) => a.key.localeCompare(b.key));
  const sortedConnections = [...tab.connections].sort((a, b) => {
    if (a.fromKey !== b.fromKey) return a.fromKey.localeCompare(b.fromKey);
    if (a.outputPort !== b.outputPort) return a.outputPort - b.outputPort;
    return a.toKey.localeCompare(b.toKey);
  });

  const g = new dagre.graphlib.Graph({ directed: true, multigraph: false, compound: false });
  g.setGraph({
    rankdir: opts.rankdir,
    nodesep: opts.nodesep,
    edgesep: opts.edgesep,
    ranksep: opts.ranksep,
    marginx: opts.grid * 2,
    marginy: opts.grid * 2,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const dimensionsByKey = new Map<string, LayoutParticipantDimensions>();
  const registeredKeys = new Set<string>();
  for (const node of sortedNodes) {
    const dims = dimensionsForNode(node);
    dimensionsByKey.set(node.key, dims);
    registeredKeys.add(node.key);
    g.setNode(node.key, { width: dims.w, height: dims.h });
  }
  for (const junction of sortedJunctions) {
    const dims = dimensionsForJunction();
    dimensionsByKey.set(junction.key, dims);
    registeredKeys.add(junction.key);
    g.setNode(junction.key, { width: dims.w, height: dims.h });
  }
  for (const conn of sortedConnections) {
    if (conn.fromKey === conn.toKey) continue;
    if (!registeredKeys.has(conn.fromKey) || !registeredKeys.has(conn.toKey)) continue;
    g.setEdge(conn.fromKey, conn.toKey);
  }

  if (registeredKeys.size > 0) {
    // @dagrejs/dagre@3 types are stricter than the old `dagre` types; the
    // graph we built above is correctly shaped at runtime even if TS can't
    // verify the parameterized Graph<G,N,E> equivalence.
    dagre.layout(g as Parameters<typeof dagre.layout>[0]);
  }

  const centerByKey = new Map<string, { x: number; y: number }>();
  for (const key of registeredKeys) {
    const dn = g.node(key) as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;
    if (dn === undefined || typeof dn.x !== 'number' || typeof dn.y !== 'number') continue;
    centerByKey.set(key, { x: dn.x, y: dn.y });
  }

  return applyPositions(tab, centerByKey, dimensionsByKey, opts);
}

export function layoutFlowsWithDagre(spec: AuthoringSpec, opts: LayoutOpts = {}): AuthoringSpec {
  const resolved: ResolvedOpts = {
    rankdir: opts.rankdir ?? LAYOUT_DEFAULTS.rankdir,
    nodesep: opts.nodesep ?? LAYOUT_DEFAULTS.nodesep,
    edgesep: opts.edgesep ?? LAYOUT_DEFAULTS.edgesep,
    ranksep: opts.ranksep ?? LAYOUT_DEFAULTS.ranksep,
    grid: opts.grid ?? DEFAULT_GRID,
    bounds: opts.bounds ?? defaultBounds,
    ...(opts.onDiagnostic !== undefined ? { onDiagnostic: opts.onDiagnostic } : {}),
  };

  const sortedTabs = [...spec.tabs].sort((a, b) => a.id.localeCompare(b.id));
  const newTabs: TabSpec[] = sortedTabs.map((tab) => layoutTab(tab, resolved));

  return { ...spec, tabs: newTabs };
}
