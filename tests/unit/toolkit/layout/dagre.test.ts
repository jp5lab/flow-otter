import { describe, expect, it } from 'vitest';

import { layoutFlowsWithDagre as layoutFlows } from '../../../../src/toolkit/layout/dagre.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import { isOnGrid } from '../../../../src/toolkit/layout/grid.js';
import { inBounds } from '../../../../src/toolkit/layout/bounds.js';

const GRID = 20;

function nodeByKey(spec: AuthoringSpec, key: string) {
  const node = spec.tabs[0]!.nodes.find((n) => n.key === key);
  if (node === undefined) throw new Error(`missing node ${key}`);
  return node;
}

function junctionByKey(spec: AuthoringSpec, key: string) {
  const junction = spec.tabs[0]!.junctions?.find((j) => j.key === key);
  if (junction === undefined) throw new Error(`missing junction ${key}`);
  return junction;
}

function chainSpec(count: number): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'tabA',
        label: 'Tab A',
        nodes: Array.from({ length: count }, (_, i) => ({
          key: `n${i.toString().padStart(2, '0')}`,
          type: 'function',
          label: `N${i}`,
          position: { x: 0, y: 0 },
        })),
        connections: Array.from({ length: count - 1 }, (_, i) => ({
          fromKey: `n${i.toString().padStart(2, '0')}`,
          outputPort: 0,
          toKey: `n${(i + 1).toString().padStart(2, '0')}`,
        })),
        groups: [],
        comments: [],
      },
    ],
  };
}

const SINGLE_NODE_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [{ key: 'only', type: 'inject', label: 'Only', position: { x: 0, y: 0 } }],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

const JUNCTION_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [
        { key: 'src', type: 'inject', label: 'Src', position: { x: 0, y: 0 } },
        { key: 'sink', type: 'debug', label: 'Sink', position: { x: 0, y: 0 } },
      ],
      junctions: [{ key: 'j1', position: { x: 0, y: 0 } }],
      connections: [
        { fromKey: 'src', outputPort: 0, toKey: 'j1' },
        { fromKey: 'j1', outputPort: 0, toKey: 'sink' },
      ],
      groups: [],
      comments: [],
    },
  ],
};

const THREE_NODE_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [
        { key: 'in', type: 'inject', label: 'In', position: { x: 0, y: 0 } },
        { key: 'fn', type: 'function', label: 'Fn', position: { x: 0, y: 0 } },
        { key: 'out', type: 'debug', label: 'Out', position: { x: 0, y: 0 } },
      ],
      connections: [
        { fromKey: 'in', outputPort: 0, toKey: 'fn' },
        { fromKey: 'fn', outputPort: 0, toKey: 'out' },
      ],
      groups: [],
      comments: [],
    },
  ],
};

const FIVE_NODE_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [
        { key: 'src1', type: 'inject', label: 'Src1', position: { x: 0, y: 0 } },
        { key: 'src2', type: 'inject', label: 'Src2', position: { x: 0, y: 0 } },
        { key: 'fan', type: 'function', label: 'Fan', position: { x: 0, y: 0 } },
        { key: 'log', type: 'debug', label: 'Log', position: { x: 0, y: 0 } },
        { key: 'sink', type: 'debug', label: 'Sink', position: { x: 0, y: 0 } },
      ],
      connections: [
        { fromKey: 'src1', outputPort: 0, toKey: 'fan' },
        { fromKey: 'src2', outputPort: 0, toKey: 'fan' },
        { fromKey: 'fan', outputPort: 0, toKey: 'log' },
        { fromKey: 'fan', outputPort: 0, toKey: 'sink' },
      ],
      groups: [],
      comments: [],
    },
  ],
};

describe('layoutFlows', () => {
  it('snaps every position to the grid and keeps in-bounds (3-node fixture)', () => {
    const out = layoutFlows(THREE_NODE_SPEC, { rankdir: 'LR' });
    expect(out.tabs).toHaveLength(1);
    const tab = out.tabs[0]!;
    expect(tab.nodes).toHaveLength(3);
    for (const node of tab.nodes) {
      expect(isOnGrid(node.position, GRID)).toBe(true);
      expect(inBounds(node.position)).toBe(true);
    }
  });

  it('produces non-overlapping positions for the 3-node line graph', () => {
    const out = layoutFlows(THREE_NODE_SPEC, { rankdir: 'LR' });
    const tab = out.tabs[0]!;
    const xs = tab.nodes.map((n) => n.position.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(xs[1]!);
    expect(xs[1]).toBeLessThan(xs[2]!);
  });

  it('is byte-deterministic across two invocations', () => {
    const a = layoutFlows(FIVE_NODE_SPEC);
    const b = layoutFlows(FIVE_NODE_SPEC);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('matches a frozen snapshot for the 5-node fixture', () => {
    const out = layoutFlows(FIVE_NODE_SPEC, { rankdir: 'LR' });
    const positions = out.tabs[0]!.nodes.map((n) => ({
      key: n.key,
      x: n.position.x,
      y: n.position.y,
    })).sort((a, b) => a.key.localeCompare(b.key));
    expect(positions).toMatchSnapshot();
  });

  it('stores dagre center coordinates, not top-left coordinates', () => {
    const out = layoutFlows(SINGLE_NODE_SPEC, { rankdir: 'LR', grid: 1 });
    expect(nodeByKey(out, 'only').position).toEqual({ x: 52, y: 17 });
  });

  it('lays out junctions as graph participants', () => {
    const out = layoutFlows(JUNCTION_SPEC, { rankdir: 'LR' });
    const src = nodeByKey(out, 'src');
    const junction = junctionByKey(out, 'j1');
    const sink = nodeByKey(out, 'sink');

    expect(junction.position).not.toEqual({ x: 0, y: 0 });
    expect(src.position.x).toBeLessThan(junction.position.x);
    expect(junction.position.x).toBeLessThan(sink.position.x);
  });

  it('translates an overflowing chain instead of clamping nodes into an x=2400 pile', () => {
    const diagnostics: Array<{ rule: string; tabId?: string; context?: Record<string, unknown> }> =
      [];
    const out = layoutFlows(chainSpec(50), {
      rankdir: 'LR',
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const xs = out.tabs[0]!.nodes.map((n) => n.position.x);

    expect(Math.max(...xs)).toBeGreaterThan(2400);
    expect(xs.filter((x) => x === 2400).length).toBeLessThanOrEqual(1);
    expect(new Set(xs).size).toBe(50);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        rule: 'layout/width-overflow',
        tabId: 'tabA',
      }),
    );
  });

  it('handles an empty tab without throwing', () => {
    const empty: AuthoringSpec = {
      tabs: [{ id: 'tabA', label: 'Empty', nodes: [], connections: [], groups: [], comments: [] }],
    };
    const out = layoutFlows(empty);
    expect(out.tabs[0]!.nodes).toHaveLength(0);
  });
});
