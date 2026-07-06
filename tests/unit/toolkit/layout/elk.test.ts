import { describe, expect, it } from 'vitest';

import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import { inBounds } from '../../../../src/toolkit/layout/bounds.js';
import { layoutFlowsWithElk } from '../../../../src/toolkit/layout/elk.js';
import { isOnGrid } from '../../../../src/toolkit/layout/grid.js';

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

const LINE_SPEC: AuthoringSpec = {
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

describe('layoutFlowsWithElk', () => {
  it('returns an AuthoringSpec with the same tabs/nodes/connections', async () => {
    const out = await layoutFlowsWithElk(LINE_SPEC, { rankdir: 'LR' });
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0]!.nodes).toHaveLength(3);
    expect(out.tabs[0]!.connections).toHaveLength(2);
  });

  it('snaps every position to the grid and keeps in-bounds', async () => {
    const out = await layoutFlowsWithElk(LINE_SPEC, { rankdir: 'LR' });
    for (const node of out.tabs[0]!.nodes) {
      expect(isOnGrid(node.position, GRID)).toBe(true);
      expect(inBounds(node.position)).toBe(true);
    }
  });

  it('produces increasing x positions for the left-to-right chain', async () => {
    const out = await layoutFlowsWithElk(LINE_SPEC, { rankdir: 'LR' });
    const tab = out.tabs[0]!;
    const inNode = tab.nodes.find((n) => n.key === 'in')!;
    const fnNode = tab.nodes.find((n) => n.key === 'fn')!;
    const outNode = tab.nodes.find((n) => n.key === 'out')!;
    expect(inNode.position.x).toBeLessThan(fnNode.position.x);
    expect(fnNode.position.x).toBeLessThan(outNode.position.x);
  });

  it('is deterministic across two invocations (randomSeed pinned)', async () => {
    const a = await layoutFlowsWithElk(LINE_SPEC, { rankdir: 'LR' });
    const b = await layoutFlowsWithElk(LINE_SPEC, { rankdir: 'LR' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('stores ELK center coordinates, not top-left coordinates', async () => {
    const out = await layoutFlowsWithElk(SINGLE_NODE_SPEC, { rankdir: 'LR', grid: 1 });
    expect(nodeByKey(out, 'only').position).toEqual({ x: 62, y: 27 });
  });

  it('lays out junctions as graph participants without throwing', async () => {
    const out = await layoutFlowsWithElk(JUNCTION_SPEC, { rankdir: 'LR' });
    const src = nodeByKey(out, 'src');
    const junction = junctionByKey(out, 'j1');
    const sink = nodeByKey(out, 'sink');

    expect(junction.position).not.toEqual({ x: 0, y: 0 });
    expect(src.position.x).toBeLessThan(junction.position.x);
    expect(junction.position.x).toBeLessThan(sink.position.x);
  });

  it('translates an overflowing chain instead of clamping nodes into an x=2400 pile', async () => {
    const diagnostics: Array<{ rule: string; tabId?: string; context?: Record<string, unknown> }> =
      [];
    const out = await layoutFlowsWithElk(chainSpec(50), {
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

  it('handles an empty tab without throwing', async () => {
    const empty: AuthoringSpec = {
      tabs: [{ id: 'tabA', label: 'Empty', nodes: [], connections: [], groups: [], comments: [] }],
    };
    const out = await layoutFlowsWithElk(empty);
    expect(out.tabs[0]!.nodes).toHaveLength(0);
  });
});
