import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../../src/shared/flows-json.js';
import { collectLayoutGeometry } from '../../../../src/toolkit/lint/geometry.js';
import { layoutLint, type LayoutLintReport } from '../../../../src/toolkit/lint/layout-lint.js';
import type { GeometryProvider } from '../../../../src/toolkit/render/metrics.js';

const TAB = { id: 'tab1', type: 'tab', label: 'Main' } as const;

const RULE_IDS = [
  'layout-stage-order',
  'layout-group-overlap',
  'layout-header-presence',
  'layout-error-lane-below',
  'layout-affirmative-on-top',
  'layout-wire-crossings',
  'layout-backward-wires',
  'layout-viewport-overflow',
] as const;

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

function rule(report: LayoutLintReport, id: (typeof RULE_IDS)[number]) {
  const found = report.rules.find((r) => r.rule === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe('layoutLint rule registry', () => {
  it('registers the eight frozen ids in audit order, with D-2 semantic rules abstaining', () => {
    const report = layoutLint(flow(regular('n1', 'inject', 100, 100, { wires: [[]] })));

    expect(report.rules.map((r) => r.rule)).toEqual(RULE_IDS);
    for (const id of [
      'layout-stage-order',
      'layout-header-presence',
      'layout-error-lane-below',
      'layout-affirmative-on-top',
    ] as const) {
      expect(rule(report, id).offenders).toEqual([]);
      const diagnostic = report.diagnostics.find(
        (d) => d.rule === id && d.message.includes('not yet implemented (D-2)'),
      );
      expect(diagnostic).toMatchObject({ severity: 'info', rule: id });
    }
  });
});

describe('layout-wire-crossings', () => {
  it('counts one crossing for an X-shaped pair', () => {
    const report = layoutLint(
      flow(
        regular('a', 'inject', 100, 100, { wires: [['d']] }),
        regular('b', 'inject', 100, 200, { wires: [['c']] }),
        regular('c', 'debug', 400, 100),
        regular('d', 'debug', 400, 200),
      ),
    );

    expect(rule(report, 'layout-wire-crossings').offenders).toHaveLength(1);
  });

  it('does not count parallel wires', () => {
    const report = layoutLint(
      flow(
        regular('a', 'inject', 100, 100, { wires: [['c']] }),
        regular('b', 'inject', 100, 200, { wires: [['d']] }),
        regular('c', 'debug', 400, 100),
        regular('d', 'debug', 400, 200),
      ),
    );

    expect(rule(report, 'layout-wire-crossings').offenders).toHaveLength(0);
  });

  it('does not count fan-out wires sharing a source port', () => {
    const report = layoutLint(
      flow(
        regular('a', 'inject', 100, 150, { wires: [['c', 'd']] }),
        regular('c', 'debug', 400, 100),
        regular('d', 'debug', 400, 200),
      ),
    );

    expect(rule(report, 'layout-wire-crossings').offenders).toHaveLength(0);
  });

  it('does not count convergence wires sharing a target port', () => {
    const report = layoutLint(
      flow(
        regular('a', 'inject', 100, 100, { wires: [['c']] }),
        regular('b', 'inject', 100, 200, { wires: [['c']] }),
        regular('c', 'debug', 400, 150),
      ),
    );

    expect(rule(report, 'layout-wire-crossings').offenders).toHaveLength(0);
  });
});

describe('layout geometry provider usage', () => {
  it('places input/output port anchors from the GeometryProvider', () => {
    const provider: GeometryProvider = {
      profile: 'test',
      nodeDimensionsFor: () => ({ w: 200, h: 60 }),
      outputPortAnchors: () => [{ x: 200, y: 12 }],
      inputPortAnchor: () => ({ x: 0, y: 44 }),
    };
    const geometry = collectLayoutGeometry(
      flow(
        regular('src', 'inject', 500, 100, { wires: [['dst']] }),
        regular('dst', 'debug', 800, 100),
      ),
      { geometryProvider: provider },
    );
    const tab = geometry.tabs.get(TAB.id);
    if (!tab) throw new Error('missing tab geometry');

    expect(tab.objects.get('src')?.outputPorts[0]).toEqual({ x: 600, y: 82 });
    expect(tab.objects.get('dst')?.inputPort).toEqual({ x: 700, y: 114 });
    expect(tab.wires[0]).toMatchObject({
      from: { nodeId: 'src', port: 0, x: 600, y: 82 },
      to: { nodeId: 'dst', x: 700, y: 114 },
    });
  });
});

describe('geometric layout rules', () => {
  it('flags backward wires using provider port x coordinates with a 20px tolerance', () => {
    const backward = layoutLint(
      flow(
        regular('src', 'inject', 400, 100, { wires: [['dst']] }),
        regular('dst', 'debug', 120, 100),
      ),
    );
    const withinTolerance = layoutLint(
      flow(
        regular('src', 'inject', 100, 100, { wires: [['dst']] }),
        regular('dst', 'debug', 180, 100),
      ),
    );

    expect(rule(backward, 'layout-backward-wires').offenders).toHaveLength(1);
    expect(rule(withinTolerance, 'layout-backward-wires').offenders).toHaveLength(0);
  });

  it('flags only overlapping sibling groups', () => {
    const report = layoutLint(
      flow(
        {
          id: 'g1',
          type: 'group',
          z: TAB.id,
          x: 100,
          y: 100,
          w: 200,
          h: 120,
          nodes: [],
        },
        {
          id: 'g2',
          type: 'group',
          z: TAB.id,
          x: 250,
          y: 150,
          w: 200,
          h: 120,
          nodes: [],
        },
        {
          id: 'g3',
          type: 'group',
          z: TAB.id,
          g: 'g1',
          x: 260,
          y: 160,
          w: 80,
          h: 60,
          nodes: [],
        },
      ),
    );

    expect(rule(report, 'layout-group-overlap').offenders).toEqual([
      expect.objectContaining({ ids: ['g1', 'g2'] }),
    ]);
  });

  it('reports viewport overflow against the usable 1920px editor window width', () => {
    const report = layoutLint(
      flow(
        regular('left', 'inject', 50, 100, { wires: [[]] }),
        regular('right', 'debug', 1610, 100),
      ),
      { viewportWindowWidth: 1920 },
    );

    expect(rule(report, 'layout-viewport-overflow').offenders).toHaveLength(1);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        rule: 'layout-viewport-overflow',
        tabId: TAB.id,
      }),
    );
  });
});

describe('layoutLint performance smoke', () => {
  it('checks a 200-node chain quickly', () => {
    const nodes: FlowsJsonNode[] = [];
    for (let i = 0; i < 200; i++) {
      nodes.push(
        regular(`n${i}`, 'function', 100 + i * 140, 100 + (i % 5) * 80, {
          wires: i === 199 ? [[]] : [[`n${i + 1}`]],
        }),
      );
    }
    const start = performance.now();
    const report = layoutLint(flow(...nodes));
    const elapsed = performance.now() - start;

    expect(report.rules).toHaveLength(8);
    expect(elapsed).toBeLessThan(50);
  });
});
