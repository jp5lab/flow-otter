import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { explainFlow } from '../../../../src/toolkit/analyze/explain.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';

interface E2Fixture {
  readonly flows: FlowsJson;
}

function loadE2Fixture(): FlowsJson {
  const path = new URL('../../../fixtures/audit-2026-06-10/e2-flows.json', import.meta.url);
  return (JSON.parse(readFileSync(path, 'utf8')) as E2Fixture).flows;
}

describe('explainFlow junction traversal', () => {
  it('walks canonical e2 junction edges hop-by-hop', () => {
    const report = explainFlow(loadE2Fixture(), 'e2spag001');

    expect(report.nodes.map((n) => n.id)).toContain('e2n12');
    expect(report.entrypoints.map((n) => n.id)).toEqual(['e2n01', 'e2n02']);
    expect(report.sinks.map((n) => n.id)).toEqual(['e2n10', 'e2n09', 'e2n11']);
    expect(report.orphans).toEqual([]);
    expect(report.edges).toEqual([
      { fromId: 'e2n01', outputPort: 0, toId: 'e2n03' },
      { fromId: 'e2n02', outputPort: 0, toId: 'e2n03' },
      { fromId: 'e2n03', outputPort: 0, toId: 'e2n04' },
      { fromId: 'e2n04', outputPort: 0, toId: 'e2n05' },
      { fromId: 'e2n04', outputPort: 0, toId: 'e2n10' },
      { fromId: 'e2n05', outputPort: 0, toId: 'e2n12' },
      { fromId: 'e2n05', outputPort: 1, toId: 'e2n07' },
      { fromId: 'e2n12', outputPort: 0, toId: 'e2n06' },
      { fromId: 'e2n06', outputPort: 0, toId: 'e2n08' },
      { fromId: 'e2n08', outputPort: 0, toId: 'e2n09' },
      { fromId: 'e2n07', outputPort: 0, toId: 'e2n11' },
    ]);
  });

  it('does not split a junction-fed chain into a disconnected sub-flow', () => {
    const report = explainFlow(
      [
        { id: 'tab1', type: 'tab', label: 'Main' },
        {
          id: 'in1',
          type: 'inject',
          z: 'tab1',
          x: 0,
          y: 0,
          wires: [['j1']],
        },
        {
          id: 'j1',
          type: 'junction',
          z: 'tab1',
          x: 100,
          y: 0,
          wires: [['fn1']],
        },
        {
          id: 'fn1',
          type: 'function',
          z: 'tab1',
          x: 200,
          y: 0,
          wires: [['end1']],
        },
        {
          id: 'end1',
          type: 'function',
          z: 'tab1',
          x: 300,
          y: 0,
          wires: [[]],
        },
      ] as FlowsJson,
      'tab1',
    );

    expect(report.entrypoints.map((n) => n.id)).toEqual(['in1']);
    expect(report.sinks.map((n) => n.id)).toEqual(['end1']);
    expect(report.edges).toEqual([
      { fromId: 'in1', outputPort: 0, toId: 'j1' },
      { fromId: 'j1', outputPort: 0, toId: 'fn1' },
      { fromId: 'fn1', outputPort: 0, toId: 'end1' },
    ]);
  });
});
