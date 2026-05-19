import dagre from '@dagrejs/dagre';

import type { AuthoringSpec, NodeSpec, TabSpec } from '../authoring/types.js';

import { defaultBounds, type Bounds } from './bounds.js';
import { DEFAULT_GRID, snapToGrid } from './grid.js';

export interface LayoutOpts {
  rankdir?: 'LR' | 'TB';
  nodesep?: number;
  edgesep?: number;
  ranksep?: number;
  grid?: number;
  bounds?: Bounds;
}

const LAYOUT_NODE_WIDTH = 120;
const LAYOUT_NODE_HEIGHT = 30;

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
}

function clampToBounds(p: { x: number; y: number }, bounds: Bounds): { x: number; y: number } {
  return {
    x: Math.min(Math.max(p.x, bounds.xMin), bounds.xMax),
    y: Math.min(Math.max(p.y, bounds.yMin), bounds.yMax),
  };
}

function layoutTab(tab: TabSpec, opts: ResolvedOpts): TabSpec {
  const sortedNodes = [...tab.nodes].sort((a, b) => a.key.localeCompare(b.key));
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

  for (const node of sortedNodes) {
    g.setNode(node.key, { width: LAYOUT_NODE_WIDTH, height: LAYOUT_NODE_HEIGHT });
  }
  for (const conn of sortedConnections) {
    if (conn.fromKey === conn.toKey) continue;
    g.setEdge(conn.fromKey, conn.toKey);
  }

  if (sortedNodes.length > 0) {
    // @dagrejs/dagre@3 types are stricter than the old `dagre` types; the
    // graph we built above is correctly shaped at runtime even if TS can't
    // verify the parameterized Graph<G,N,E> equivalence.
    dagre.layout(g as Parameters<typeof dagre.layout>[0]);
  }

  const positionByKey = new Map<string, { x: number; y: number }>();
  for (const node of sortedNodes) {
    const dn = g.node(node.key) as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;
    if (dn === undefined || typeof dn.x !== 'number' || typeof dn.y !== 'number') continue;
    const topLeft = {
      x: dn.x - LAYOUT_NODE_WIDTH / 2,
      y: dn.y - LAYOUT_NODE_HEIGHT / 2,
    };
    const snapped = snapToGrid(topLeft, opts.grid);
    const clamped = clampToBounds(snapped, opts.bounds);
    const final = snapToGrid(clamped, opts.grid);
    positionByKey.set(node.key, final);
  }

  const nodes: NodeSpec[] = tab.nodes.map((n) => {
    const pos = positionByKey.get(n.key);
    if (pos === undefined) return n;
    return { ...n, position: pos };
  });

  return { ...tab, nodes };
}

export function layoutFlowsWithDagre(spec: AuthoringSpec, opts: LayoutOpts = {}): AuthoringSpec {
  const resolved: ResolvedOpts = {
    rankdir: opts.rankdir ?? LAYOUT_DEFAULTS.rankdir,
    nodesep: opts.nodesep ?? LAYOUT_DEFAULTS.nodesep,
    edgesep: opts.edgesep ?? LAYOUT_DEFAULTS.edgesep,
    ranksep: opts.ranksep ?? LAYOUT_DEFAULTS.ranksep,
    grid: opts.grid ?? DEFAULT_GRID,
    bounds: opts.bounds ?? defaultBounds,
  };

  const sortedTabs = [...spec.tabs].sort((a, b) => a.id.localeCompare(b.id));
  const newTabs: TabSpec[] = sortedTabs.map((tab) => layoutTab(tab, resolved));

  return { ...spec, tabs: newTabs };
}
