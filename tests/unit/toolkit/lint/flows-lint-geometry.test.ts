import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../../src/shared/flows-json.js';
import { lintFlows } from '../../../../src/toolkit/lint/flows-lint.js';

const TAB = { id: 'tab1', type: 'tab', label: 'Main' } as const;

function flow(...nodes: FlowsJsonNode[]): FlowsJson {
  return [TAB, ...nodes] as FlowsJson;
}

function regular(
  id: string,
  type: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): FlowsJsonNode {
  return { id, type, z: TAB.id, x, y, wires: [], ...extra };
}

describe('lintFlows geometry migration', () => {
  it('keeps bbox-overlap stable while using provider-driven centered boxes for wide nodes', () => {
    const report = lintFlows(
      flow(
        regular('wide-a', 'function', 100, 100, {
          name: 'Debounce repeat alarms',
          wires: [[]],
        }),
        regular('wide-b', 'function', 240, 100, {
          name: 'Debounce repeat alarms',
          wires: [[]],
        }),
      ),
    );

    expect(report.diagnostics.filter((d) => d.rule === 'bbox-overlap')).toEqual([
      expect.objectContaining({ severity: 'warning', nodeId: 'wide-a' }),
    ]);
  });

  it('clears narrow nodes 110px apart that the old 120px top-left boxes caught', () => {
    const report = lintFlows(
      flow(
        regular('narrow-a', 'inject', 100, 100, { wires: [[]] }),
        regular('narrow-b', 'inject', 210, 100, { wires: [[]] }),
      ),
      { grid: 10 },
    );

    expect(report.diagnostics.filter((d) => d.rule === 'bbox-overlap')).toEqual([]);
  });

  it('records centered bbox coordinates in overlap diagnostics', () => {
    const report = lintFlows(
      flow(
        regular('a', 'inject', 100, 100, { wires: [[]] }),
        regular('b', 'inject', 190, 100, { wires: [[]] }),
      ),
      { grid: 10 },
    );
    const [overlap] = report.diagnostics.filter((d) => d.rule === 'bbox-overlap');

    expect(overlap?.context).toMatchObject({
      a: { x1: 50, y1: 85 },
      b: { x1: 140, y1: 85 },
    });
  });

  it('warns, but does not error, for a group half off canvas', () => {
    const report = lintFlows(
      flow({
        id: 'g1',
        type: 'group',
        z: TAB.id,
        x: -40,
        y: 100,
        w: 160,
        h: 120,
        nodes: [],
      }),
    );

    expect(report.errors).toEqual([]);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', rule: 'off-canvas', nodeId: 'g1' }),
    );
  });

  it('warns, but does not error, for a comment with a negative center', () => {
    const report = lintFlows(
      flow({
        id: 'c1',
        type: 'comment',
        z: TAB.id,
        x: -20,
        y: 100,
        name: 'operator note',
      }),
    );

    expect(report.errors).toEqual([]);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', rule: 'off-canvas', nodeId: 'c1' }),
    );
  });

  it("keeps regular node off-canvas as today's error-severity gate", () => {
    const report = lintFlows(flow(regular('n1', 'inject', -20, 100, { wires: [[]] })));

    expect(report.errors).toContainEqual(
      expect.objectContaining({ severity: 'error', rule: 'off-canvas', nodeId: 'n1' }),
    );
  });
});
