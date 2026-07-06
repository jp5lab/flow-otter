import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../../src/shared/flows-json.js';
import { collectLayoutGeometry } from '../../../../src/toolkit/lint/geometry.js';
import { layoutLint, type LayoutLintReport } from '../../../../src/toolkit/lint/layout-lint.js';
import { deriveFlowsJsonLanes } from '../../../../src/toolkit/lanes.js';
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

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function fixtureFlows(name: string): FlowsJson {
  const raw = readFileSync(
    new URL(`../../../fixtures/audit-2026-06-10/${name}`, import.meta.url),
    'utf8',
  );
  return (JSON.parse(raw) as { flows: FlowsJson }).flows;
}

describe('layoutLint rule registry', () => {
  it('registers the eight frozen ids in audit order', () => {
    const report = layoutLint(flow(regular('n1', 'inject', 100, 100, { wires: [[]] })));

    expect(report.rules.map((r) => r.rule)).toEqual(RULE_IDS);
    expect(report.diagnostics.some((d) => d.message.includes('not yet implemented'))).toBe(false);
  });
});

describe('semantic layout rules', () => {
  it('uses medians for error-lane-below so the e1-agent 560-over-260 shape passes', () => {
    const report = layoutLint(
      flow(
        regular('main1', 'inject', 100, 100, { wires: [[]] }),
        regular('main2', 'function', 300, 260, { wires: [[]] }),
        regular('main-outlier', 'debug', 500, 700),
        regular('catch1', 'catch', 100, 520, { wires: [['err-fn']] }),
        regular('err-fn', 'function', 300, 560, { wires: [['err-debug']] }),
        regular('err-debug', 'debug', 500, 600),
      ),
    );

    expect(rule(report, 'layout-error-lane-below').offenders).toHaveLength(0);
  });

  it('pins canonical e1-agent lane medians at main 260 and error 560', () => {
    const flows = fixtureFlows('e1-flows.json');
    const geometry = collectLayoutGeometry(flows);
    const tab = [...geometry.tabs.values()][0]!;
    const lanes = deriveFlowsJsonLanes(flows).get(tab.tabId)?.lanesById;
    if (lanes === undefined) throw new Error('missing lane derivation');
    const mainYs: number[] = [];
    const errorYs: number[] = [];
    for (const object of tab.objects.values()) {
      const lane = lanes.get(object.id);
      if (lane === 'main') mainYs.push(object.center.y);
      else if (lane === 'error') errorYs.push(object.center.y);
    }

    expect(medianOf(mainYs)).toBe(260);
    expect(medianOf(errorYs)).toBe(560);
    expect(rule(layoutLint(flows), 'layout-error-lane-below').offenders).toHaveLength(0);
  });

  it('flags an error lane whose median is not below the main lane median', () => {
    const report = layoutLint(
      flow(
        regular('main1', 'inject', 100, 240, { wires: [[]] }),
        regular('main2', 'debug', 500, 260),
        regular('catch1', 'catch', 100, 100, { wires: [['err-fn']] }),
        regular('err-fn', 'function', 300, 120, { wires: [['err-debug']] }),
        regular('err-debug', 'debug', 500, 140),
      ),
    );

    expect(rule(report, 'layout-error-lane-below').offenders).toEqual([
      expect.objectContaining({ tabId: TAB.id, mainMedianY: 250, errorMedianY: 120 }),
    ]);
  });

  it('flags inter-group DAG edges that run right-to-left by group centroid', () => {
    const report = layoutLint(
      flow(
        {
          id: 'g-src',
          type: 'group',
          z: TAB.id,
          x: 500,
          y: 80,
          w: 220,
          h: 120,
          name: 'Later',
          nodes: ['src'],
        },
        {
          id: 'g-dst',
          type: 'group',
          z: TAB.id,
          x: 100,
          y: 80,
          w: 220,
          h: 120,
          name: 'Earlier',
          nodes: ['dst'],
        },
        regular('src', 'inject', 580, 140, { g: 'g-src', wires: [['dst']] }),
        regular('dst', 'debug', 180, 140, { g: 'g-dst' }),
      ),
    );

    expect(rule(report, 'layout-stage-order').offenders).toEqual([
      expect.objectContaining({ fromGroupId: 'g-src', toGroupId: 'g-dst' }),
    ]);
  });

  it('flags switch output port 0 routed below a later port target', () => {
    const report = layoutLint(
      flow(
        regular('sw', 'switch', 100, 200, {
          outputs: 2,
          wires: [['no'], ['yes']],
        }),
        regular('yes', 'debug', 400, 100),
        regular('no', 'debug', 400, 300),
      ),
    );

    expect(rule(report, 'layout-affirmative-on-top').offenders).toEqual([
      expect.objectContaining({ nodeId: 'sw', port0MeanTargetY: 300, comparedPort: 1 }),
    ]);
  });

  it('requires groups with at least three members to have a name or explicit header comment', () => {
    const missing = layoutLint(
      flow(
        {
          id: 'g1',
          type: 'group',
          z: TAB.id,
          x: 80,
          y: 80,
          w: 500,
          h: 180,
          name: '',
          nodes: ['a', 'b', 'c'],
        },
        regular('a', 'inject', 140, 140, { g: 'g1', wires: [[]] }),
        regular('b', 'function', 300, 140, { g: 'g1', wires: [[]] }),
        regular('c', 'debug', 460, 140, { g: 'g1' }),
      ),
    );
    const withHeader = layoutLint(
      flow(
        {
          id: 'g1',
          type: 'group',
          z: TAB.id,
          x: 80,
          y: 120,
          w: 500,
          h: 180,
          name: '',
          nodes: ['a', 'b', 'c'],
        },
        {
          id: 'header1',
          type: 'comment',
          z: TAB.id,
          x: 300,
          y: 80,
          name: 'Decision',
          _authoringHeaderFor: 'g1',
        },
        regular('a', 'inject', 140, 180, { g: 'g1', wires: [[]] }),
        regular('b', 'function', 300, 180, { g: 'g1', wires: [[]] }),
        regular('c', 'debug', 460, 180, { g: 'g1' }),
      ),
    );

    expect(rule(missing, 'layout-header-presence').offenders).toEqual([
      expect.objectContaining({ groupId: 'g1', memberCount: 3 }),
    ]);
    expect(rule(withHeader, 'layout-header-presence').offenders).toHaveLength(0);
  });

  it('abstains semantic rules when their evidence is absent', () => {
    const report = layoutLint(
      flow(
        regular('src', 'inject', 100, 100, { wires: [['dst']] }),
        regular('dst', 'debug', 300, 100),
      ),
    );

    for (const id of [
      'layout-stage-order',
      'layout-header-presence',
      'layout-error-lane-below',
      'layout-affirmative-on-top',
    ] as const) {
      expect(rule(report, id).offenders).toHaveLength(0);
      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({ severity: 'info', rule: id }),
      );
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
