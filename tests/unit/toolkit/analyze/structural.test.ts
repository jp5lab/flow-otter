import { describe, expect, it } from 'vitest';

import { analyzeAllFlows, analyzeFlow } from '../../../../src/toolkit/analyze/structural.js';

const FLOWS = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  { id: 'tab2', type: 'tab', label: 'Other' },
  {
    id: 'in1',
    type: 'inject',
    z: 'tab1',
    x: 0,
    y: 0,
    wires: [['out1', 'fn1']],
    name: 'Tick',
  },
  { id: 'fn1', type: 'function', z: 'tab1', x: 100, y: 0, wires: [['out1']], func: 'return msg;' },
  { id: 'out1', type: 'debug', z: 'tab1', x: 200, y: 0, wires: [], name: 'Out' },
  {
    id: 'lonely',
    type: 'function',
    z: 'tab2',
    x: 0,
    y: 0,
    wires: [[]],
    func: 'return msg;',
  },
];

describe('analyzeFlow', () => {
  it('computes per-tab structural report', () => {
    const report = analyzeFlow(FLOWS, 'tab1');
    expect(report.tabId).toBe('tab1');
    expect(report.counts.nodes).toBe(3);
    expect(report.counts.wires).toBe(3);
    expect(report.typeHistogram).toEqual({ inject: 1, function: 1, debug: 1 });
    expect(report.orphans).toEqual([]);
  });

  it('marks orphan node on lonely tab', () => {
    const report = analyzeFlow(FLOWS, 'tab2');
    expect(report.orphans).toEqual(['lonely']);
  });

  it('does not mark dashboard widgets as flow orphans', () => {
    const report = analyzeFlow(
      [
        { id: 'tab1', type: 'tab', label: 'Main' },
        { id: 'base1', type: 'ui-base', name: 'Base' },
        { id: 'page1', type: 'ui-page', name: 'Page', ui: 'base1' },
        { id: 'group1', type: 'ui-group', name: 'Group', page: 'page1' },
        {
          id: 'status',
          type: 'ui-template',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [],
          group: 'group1',
        },
      ] as never,
      'tab1',
    );
    expect(report.dashboardWidgets).toBe(1);
    expect(report.orphans).toEqual([]);
    expect(report.validation.errors.map((d) => d.rule)).not.toContain('dashboard-hierarchy');
  });

  it('validates per-tab subflow instances with global definition context', () => {
    const report = analyzeFlow(
      [
        { id: 'tab1', type: 'tab', label: 'Main' },
        {
          id: 'sf1',
          type: 'subflow',
          name: 'shared/subflow',
          in: [{ wires: [] }],
          out: [{ wires: [] }],
        },
        {
          id: 'instance1',
          type: 'subflow:sf1',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [[]],
        },
      ] as never,
      'tab1',
    );
    expect(report.validation.errors.map((d) => d.rule)).not.toContain('subflow-ports');
  });

  it('threads naming contract options into validation', () => {
    const report = analyzeFlow(FLOWS, 'tab1', {
      namingContract: {
        schemaVersion: 1,
        types: { inject: { labelPattern: '^MustNotMatch$' } },
      },
    });
    expect(report.validation.warnings.map((d) => d.rule)).toContain('naming-contract');
  });

  it('throws on missing tab', () => {
    expect(() => analyzeFlow(FLOWS as never, 'missing')).toThrow(/not found/);
  });
});

describe('analyzeAllFlows', () => {
  it('aggregates totals across tabs', () => {
    const all = analyzeAllFlows(FLOWS);
    expect(all.totals.tabs).toBe(2);
    expect(all.totals.nodes).toBe(4);
    expect(all.perTab).toHaveLength(2);
    expect(all.typeHistogram).toEqual({ inject: 1, function: 2, debug: 1 });
  });
});
