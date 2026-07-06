import { describe, expect, it } from 'vitest';

import { explainFlow } from '../../../../src/toolkit/analyze/explain.js';

describe('explainFlow', () => {
  it('finds entrypoints and sinks for a simple flow', () => {
    const report = explainFlow(
      [
        { id: 'tab1', type: 'tab', label: 'Main' },
        {
          id: 'in1',
          type: 'inject',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [['out1']],
          name: 'Tick',
        },
        { id: 'out1', type: 'debug', z: 'tab1', x: 100, y: 0, wires: [], name: 'Out' },
      ] as never,
      'tab1',
    );
    expect(report.entrypoints.map((e) => e.id)).toEqual(['in1']);
    expect(report.sinks.map((s) => s.id)).toEqual(['out1']);
    expect(report.orphans).toEqual([]);
    expect(report.edges).toEqual([{ fromId: 'in1', outputPort: 0, toId: 'out1', kind: 'wire' }]);
  });

  it('flags orphan nodes', () => {
    const report = explainFlow(
      [
        { id: 'tab1', type: 'tab', label: 'Main' },
        {
          id: 'lonely',
          type: 'function',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
          name: 'Stranded',
        },
      ] as never,
      'tab1',
    );
    expect(report.orphans.map((o) => o.id)).toEqual(['lonely']);
    expect(report.notes.some((n) => n.includes('orphan'))).toBe(true);
  });

  it('throws when tab is missing', () => {
    expect(() => explainFlow([{ id: 't1', type: 'tab', label: 'A' }] as never, 'missing')).toThrow(
      /not found/,
    );
  });
});
