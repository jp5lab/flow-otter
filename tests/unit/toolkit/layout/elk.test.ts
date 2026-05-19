import { describe, expect, it } from 'vitest';

import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import { inBounds } from '../../../../src/toolkit/layout/bounds.js';
import { layoutFlowsWithElk } from '../../../../src/toolkit/layout/elk.js';
import { isOnGrid } from '../../../../src/toolkit/layout/grid.js';

const GRID = 20;

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

  it('handles an empty tab without throwing', async () => {
    const empty: AuthoringSpec = {
      tabs: [{ id: 'tabA', label: 'Empty', nodes: [], connections: [], groups: [], comments: [] }],
    };
    const out = await layoutFlowsWithElk(empty);
    expect(out.tabs[0]!.nodes).toHaveLength(0);
  });
});
