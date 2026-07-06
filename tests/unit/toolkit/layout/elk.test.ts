import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import { dimensionsForNode } from '../../../../src/toolkit/layout/apply-positions.js';
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

function nodeRect(spec: AuthoringSpec, key: string) {
  const node = nodeByKey(spec, key);
  const dims = dimensionsForNode(node);
  return {
    x1: node.position.x - dims.w / 2,
    y1: node.position.y - dims.h / 2,
    x2: node.position.x + dims.w / 2,
    y2: node.position.y + dims.h / 2,
  };
}

function rectContains(
  outer: ReturnType<typeof nodeRect>,
  inner: ReturnType<typeof nodeRect>,
): boolean {
  return (
    inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2
  );
}

function unionRects(rects: Array<ReturnType<typeof nodeRect>>) {
  const [first, ...rest] = rects;
  if (first === undefined) throw new Error('cannot union empty rect list');
  return rest.reduce(
    (acc, rect) => ({
      x1: Math.min(acc.x1, rect.x1),
      y1: Math.min(acc.y1, rect.y1),
      x2: Math.max(acc.x2, rect.x2),
      y2: Math.max(acc.y2, rect.y2),
    }),
    first,
  );
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

const SWITCH_PORT_ORDER_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [
        { key: 'src', type: 'inject', label: 'Src', position: { x: 0, y: 0 } },
        {
          key: 'sw',
          type: 'switch',
          label: 'Route',
          position: { x: 0, y: 0 },
          passthrough: { rules: [{ t: 'eq', v: 'yes' }, { t: 'else' }] },
        },
        { key: 'a_else', type: 'debug', label: 'Else', position: { x: 0, y: 0 } },
        { key: 'z_affirmative', type: 'debug', label: 'Affirmative', position: { x: 0, y: 0 } },
      ],
      connections: [
        { fromKey: 'src', outputPort: 0, toKey: 'sw' },
        { fromKey: 'sw', outputPort: 0, toKey: 'z_affirmative' },
        { fromKey: 'sw', outputPort: 1, toKey: 'a_else' },
      ],
      groups: [],
      comments: [],
    },
  ],
};

const NESTED_GROUP_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [
        { key: 'before', type: 'inject', label: 'Before', position: { x: 0, y: 0 } },
        {
          key: 'outer_in',
          type: 'function',
          label: 'Outer In',
          position: { x: 0, y: 0 },
          groupKey: 'outer',
        },
        {
          key: 'inner_a',
          type: 'function',
          label: 'Inner A',
          position: { x: 0, y: 0 },
          groupKey: 'inner',
        },
        {
          key: 'inner_b',
          type: 'function',
          label: 'Inner B',
          position: { x: 0, y: 0 },
          groupKey: 'inner',
        },
        {
          key: 'outer_out',
          type: 'function',
          label: 'Outer Out',
          position: { x: 0, y: 0 },
          groupKey: 'outer',
        },
        { key: 'after', type: 'debug', label: 'After', position: { x: 0, y: 0 } },
      ],
      connections: [
        { fromKey: 'before', outputPort: 0, toKey: 'outer_in' },
        { fromKey: 'outer_in', outputPort: 0, toKey: 'inner_a' },
        { fromKey: 'inner_a', outputPort: 0, toKey: 'inner_b' },
        { fromKey: 'inner_b', outputPort: 0, toKey: 'outer_out' },
        { fromKey: 'outer_out', outputPort: 0, toKey: 'after' },
      ],
      groups: [
        { key: 'outer', name: 'Outer', nodeKeys: ['outer_in', 'outer_out'] },
        { key: 'inner', name: 'Inner', nodeKeys: ['inner_a', 'inner_b'], parentKey: 'outer' },
      ],
      comments: [],
    },
  ],
};

const GROUPED_JUNCTION_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [
        { key: 'src', type: 'inject', label: 'Src', position: { x: 0, y: 0 }, groupKey: 'g1' },
        { key: 'sink', type: 'debug', label: 'Sink', position: { x: 0, y: 0 }, groupKey: 'g1' },
      ],
      junctions: [{ key: 'j1', position: { x: 0, y: 0 }, groupKey: 'g1' }],
      connections: [
        { fromKey: 'src', outputPort: 0, toKey: 'j1' },
        { fromKey: 'j1', outputPort: 0, toKey: 'sink' },
      ],
      groups: [{ key: 'g1', name: 'Grouped Junction', nodeKeys: ['src', 'j1', 'sink'] }],
      comments: [],
    },
  ],
};

const WIDE_NODE_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tabA',
      label: 'Tab A',
      nodes: [
        {
          key: 'wide',
          type: 'function',
          label: 'Wide provider measured label that must exceed two hundred forty pixels',
          position: { x: 0, y: 0 },
        },
        { key: 'next', type: 'debug', label: 'Next', position: { x: 0, y: 0 } },
      ],
      connections: [{ fromKey: 'wide', outputPort: 0, toKey: 'next' }],
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

  it('keeps switch output 0 target strictly above output 1 target', async () => {
    const out = await layoutFlowsWithElk(SWITCH_PORT_ORDER_SPEC, { rankdir: 'LR' });

    expect(nodeByKey(out, 'z_affirmative').position.y).toBeLessThan(
      nodeByKey(out, 'a_else').position.y,
    );
  });

  it('positions members inside nested compound groups', async () => {
    const out = await layoutFlowsWithElk(NESTED_GROUP_SPEC, { rankdir: 'LR' });
    const innerBox = unionRects([nodeRect(out, 'inner_a'), nodeRect(out, 'inner_b')]);
    const outerBox = unionRects([
      nodeRect(out, 'outer_in'),
      nodeRect(out, 'inner_a'),
      nodeRect(out, 'inner_b'),
      nodeRect(out, 'outer_out'),
    ]);

    for (const key of ['outer_in', 'inner_a', 'inner_b', 'outer_out']) {
      expect(nodeByKey(out, key).position).not.toEqual({ x: 0, y: 0 });
    }
    expect(rectContains(outerBox, innerBox)).toBe(true);
    expect(innerBox.x2 - innerBox.x1).toBeLessThan(outerBox.x2 - outerBox.x1);
  });

  it('lays out a junction-bearing grouped tab without throwing', async () => {
    const out = await layoutFlowsWithElk(GROUPED_JUNCTION_SPEC, { rankdir: 'LR' });

    expect(junctionByKey(out, 'j1').position).not.toEqual({ x: 0, y: 0 });
  });

  it('uses provider node width for wide labels when separating layer neighbors', async () => {
    const wideDims = dimensionsForNode(WIDE_NODE_SPEC.tabs[0]!.nodes[0]!);
    expect(wideDims.w).toBeGreaterThanOrEqual(240);

    const out = await layoutFlowsWithElk(WIDE_NODE_SPEC, { rankdir: 'LR', grid: 1 });
    const wideRect = nodeRect(out, 'wide');
    const nextRect = nodeRect(out, 'next');

    expect(wideRect.x2).toBeLessThanOrEqual(nextRect.x1);
  });

  it('is deterministic across compound and port-aware layouts', async () => {
    const a = await layoutFlowsWithElk(NESTED_GROUP_SPEC, { rankdir: 'LR' });
    const b = await layoutFlowsWithElk(NESTED_GROUP_SPEC, { rankdir: 'LR' });
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

  it('returns the tab untouched and emits a warning diagnostic when ELK rejects', async () => {
    vi.resetModules();
    vi.doMock('elkjs/lib/elk.bundled.js', () => ({
      default: class FailingElk {
        layout(): Promise<never> {
          return Promise.reject(new Error('mock elk failed'));
        }
      },
    }));

    try {
      const diagnostics: Array<{
        rule: string;
        severity: string;
        tabId?: string;
        message: string;
      }> = [];
      const { layoutFlowsWithElk: layoutWithFailingElk } =
        await import('../../../../src/toolkit/layout/elk.js');
      const out = await layoutWithFailingElk(LINE_SPEC, {
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });

      expect(out).toEqual(LINE_SPEC);
      const diagnostic = diagnostics.find((candidate) => candidate.rule === 'layout/engine-error');
      expect(diagnostic).toMatchObject({
        rule: 'layout/engine-error',
        severity: 'warning',
        tabId: 'tabA',
      });
      expect(diagnostic?.message).toContain('mock elk failed');
    } finally {
      vi.doUnmock('elkjs/lib/elk.bundled.js');
      vi.resetModules();
    }
  });

  it('F10 grep-guard: ELK dimensions flow from the GeometryProvider helpers', () => {
    const source = readFileSync(
      new URL('../../../../src/toolkit/layout/elk.ts', import.meta.url),
      'utf8',
    );
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    expect(sourceWithoutComments).not.toMatch(/\bwidth:\s*120\b|\bw:\s*120\b/);
    expect(sourceWithoutComments).toContain('dimensionsForNode');
  });
});
