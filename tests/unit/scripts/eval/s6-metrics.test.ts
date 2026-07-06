/**
 * EVAL-4-skeleton — S6 raw metrics and position-stripping pins.
 */
import { describe, expect, it } from 'vitest';

import { flowMetrics, stripPositions } from '../../../../scripts/eval/benchmark/metrics.mjs';

describe('flowMetrics', () => {
  it('counts positioned nodes, wires, backward wires, strict crossings, and extent', () => {
    const flows = [
      { id: 'tab1', type: 'tab' },
      { id: 'a', type: 'inject', z: 'tab1', x: 0, y: 0, wires: [['b', 'c']] },
      { id: 'b', type: 'debug', z: 'tab1', x: 10, y: 10, wires: [] },
      { id: 'c', type: 'function', z: 'tab1', x: 0, y: 10, wires: [['d']] },
      { id: 'd', type: 'debug', z: 'tab1', x: 10, y: 0, wires: [] },
      { id: 'e', type: 'inject', z: 'tab1', x: 20, y: 20, wires: [['f']] },
      { id: 'f', type: 'debug', z: 'tab1', x: 5, y: 20, wires: [] },
    ];

    expect(flowMetrics(flows, 'tab1')).toEqual({
      nodes: 6,
      wires: 4,
      backwardWires: 1,
      straightLineCrossings: 1,
      extent: { w: 20, h: 20 },
    });
  });

  it('skips crossings for edge pairs sharing a node', () => {
    const flows = [
      { id: 'a', z: 'tab1', x: 0, y: 0, wires: [['b', 'c']] },
      { id: 'b', z: 'tab1', x: 10, y: 10, wires: [['c']] },
      { id: 'c', z: 'tab1', x: 0, y: 10, wires: [] },
    ];

    expect(flowMetrics(flows, 'tab1').straightLineCrossings).toBe(0);
  });

  it('returns zero extent and counts when a tab has no positioned nodes', () => {
    const flows = [
      { id: 'a', z: 'tab1', wires: [['b']] },
      { id: 'b', z: 'tab1', wires: [] },
      { id: 'c', z: 'other', x: 1, y: 1, wires: [] },
    ];

    expect(flowMetrics(flows, 'tab1')).toEqual({
      nodes: 0,
      wires: 0,
      backwardWires: 0,
      straightLineCrossings: 0,
      extent: { w: 0, h: 0 },
    });
  });
});

describe('stripPositions', () => {
  it('zeros node/comment/junction positions, drops group position/size, and does not mutate input', () => {
    const spec = {
      name: 'demo',
      tabs: [
        {
          id: 'tab1',
          nodes: [{ id: 'n1', position: { x: 100, y: 200 }, type: 'inject' }],
          comments: [{ id: 'c1', position: { x: 300, y: 400 }, text: 'note' }],
          groups: [
            {
              id: 'g1',
              position: { x: 10, y: 20 },
              size: { w: 300, h: 100 },
              label: 'group',
            },
          ],
          junctions: [{ id: 'j1', position: { x: 50, y: 60 }, wires: [] }],
        },
      ],
    };

    const stripped = stripPositions(spec);

    expect(stripped.tabs[0]!.nodes[0]).toMatchObject({ position: { x: 0, y: 0 } });
    expect(stripped.tabs[0]!.comments[0]).toMatchObject({ position: { x: 0, y: 0 } });
    expect(stripped.tabs[0]!.junctions[0]).toMatchObject({ position: { x: 0, y: 0 } });
    expect(stripped.tabs[0]!.groups[0]).toEqual({ id: 'g1', label: 'group' });
    expect(spec.tabs[0]!.nodes[0]!.position).toEqual({ x: 100, y: 200 });
    expect(spec.tabs[0]!.groups[0]!.position).toEqual({ x: 10, y: 20 });
  });
});
