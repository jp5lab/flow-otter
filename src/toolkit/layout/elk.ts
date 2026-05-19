/**
 * elkjs-backed layout for FlowOtter. Used for flows with groups, multi-output
 * nodes, or ≥30 total nodes — where dagre starts producing crowded layouts.
 *
 * Determinism: `elk.randomSeed: 1` (not 0; seed 0 re-seeds from system time).
 * Combined with sorted input and pinned elkjs version, layouts are
 * byte-stable across runs.
 *
 * Bundle: this module imports `elkjs/lib/elk.bundled.js` which inlines the
 * algorithm. No worker file deployment needed. Node 22+ users hit elkjs
 * issue #377 (env-detection sees globalThis.self and tries to instantiate
 * a real Worker); we sidestep it by passing a FakeWorker factory.
 */

import elkPkg from 'elkjs/lib/elk.bundled.js';
import type { ELK as ELKType, ELKConstructorArguments, ElkNode } from 'elkjs/lib/elk.bundled.js';

// elkjs ships as a UMD bundle. Under ESM TypeScript, the default-import
// type resolves to `typeof import(...)` (a namespace) rather than the
// constructable class the runtime actually provides. Re-cast through a
// typed constructor alias so callers get type-checked.
type ElkConstructor = new (args?: ELKConstructorArguments) => ELKType;
const ELK = elkPkg as unknown as ElkConstructor;

import type { AuthoringSpec, NodeSpec, TabSpec } from '../authoring/types.js';

import { defaultBounds, type Bounds } from './bounds.js';
import { DEFAULT_GRID, snapToGrid } from './grid.js';

export interface ElkLayoutOpts {
  rankdir?: 'LR' | 'TB';
  nodesep?: number;
  ranksep?: number;
  grid?: number;
  bounds?: Bounds;
}

const NODE_W = 120;
const NODE_H = 30;

const DEFAULTS = {
  rankdir: 'LR' as const,
  nodesep: 40,
  ranksep: 80,
};

interface ResolvedOpts {
  rankdir: 'LR' | 'TB';
  nodesep: number;
  ranksep: number;
  grid: number;
  bounds: Bounds;
}

// The bundled file (`elkjs/lib/elk.bundled.js`) inlines the algorithm and
// runs synchronously when no workerFactory is provided. On Node 22+/Bun
// where `globalThis.self` exists, elkjs#377 can bite — but only when ELK
// tries to use Web Worker. The bundled path doesn't, so we deliberately
// omit workerFactory here. If we ever switch to elk-api.js (worker-based),
// re-enable the FakeWorker shim above.
const elk = new ELK();

function elkDirection(rankdir: ResolvedOpts['rankdir']): 'RIGHT' | 'DOWN' {
  return rankdir === 'LR' ? 'RIGHT' : 'DOWN';
}

function clampToBounds(p: { x: number; y: number }, b: Bounds): { x: number; y: number } {
  return {
    x: Math.min(Math.max(p.x, b.xMin), b.xMax),
    y: Math.min(Math.max(p.y, b.yMin), b.yMax),
  };
}

async function layoutTab(tab: TabSpec, opts: ResolvedOpts): Promise<TabSpec> {
  // Deterministic input ordering: sort nodes by key, edges by from/port/to.
  // ELK's `considerModelOrder.strategy: NODES_AND_EDGES` honors this when
  // it doesn't add crossings — making layouts stable across small edits.
  const sortedNodes = [...tab.nodes].sort((a, b) => a.key.localeCompare(b.key));
  const sortedConnections = [...tab.connections].sort((a, b) => {
    if (a.fromKey !== b.fromKey) return a.fromKey.localeCompare(b.fromKey);
    if (a.outputPort !== b.outputPort) return a.outputPort - b.outputPort;
    return a.toKey.localeCompare(b.toKey);
  });

  if (sortedNodes.length === 0) return tab;

  const graph: ElkNode = {
    id: tab.id,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': elkDirection(opts.rankdir),
      'elk.randomSeed': '1',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.spacing.nodeNode': String(opts.nodesep),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.ranksep),
    },
    children: sortedNodes.map((n) => ({
      id: n.key,
      width: NODE_W,
      height: NODE_H,
    })),
    edges: sortedConnections
      .filter((c) => c.fromKey !== c.toKey)
      .map((c, i) => ({
        id: `e${i}:${c.fromKey}-${c.outputPort}-${c.toKey}`,
        sources: [c.fromKey],
        targets: [c.toKey],
      })),
  };

  const laid = await elk.layout(graph);

  const positionByKey = new Map<string, { x: number; y: number }>();
  for (const child of laid.children ?? []) {
    if (typeof child.x !== 'number' || typeof child.y !== 'number') continue;
    const snapped = snapToGrid({ x: child.x, y: child.y }, opts.grid);
    const clamped = clampToBounds(snapped, opts.bounds);
    positionByKey.set(child.id, snapToGrid(clamped, opts.grid));
  }

  const nodes: NodeSpec[] = tab.nodes.map((n) => {
    const pos = positionByKey.get(n.key);
    if (pos === undefined) return n;
    return { ...n, position: pos };
  });

  return { ...tab, nodes };
}

/**
 * ELK-backed layout. Same shape as layoutFlowsWithDagre but async (elkjs
 * is Promise-based even for in-process layout).
 */
export async function layoutFlowsWithElk(
  spec: AuthoringSpec,
  opts: ElkLayoutOpts = {},
): Promise<AuthoringSpec> {
  const resolved: ResolvedOpts = {
    rankdir: opts.rankdir ?? DEFAULTS.rankdir,
    nodesep: opts.nodesep ?? DEFAULTS.nodesep,
    ranksep: opts.ranksep ?? DEFAULTS.ranksep,
    grid: opts.grid ?? DEFAULT_GRID,
    bounds: opts.bounds ?? defaultBounds,
  };
  // Sort tabs for determinism, mirroring dagre.ts.
  const sortedTabs = [...spec.tabs].sort((a, b) => a.id.localeCompare(b.id));
  const newTabs: TabSpec[] = [];
  for (const tab of sortedTabs) newTabs.push(await layoutTab(tab, resolved));
  return { ...spec, tabs: newTabs };
}
