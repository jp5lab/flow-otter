import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadAudit20260610FixtureJson } from '../../../fixtures/audit-2026-06-10/loader.js';
import { FlowsJsonSchema, type FlowsJson } from '../../../../src/shared/flows-json.js';
import { compile } from '../../../../src/toolkit/authoring/compile.js';
import { decompile } from '../../../../src/toolkit/authoring/decompile.js';
import type { AuthoringSpec, TabSpec } from '../../../../src/toolkit/authoring/types.js';
import { applyPositions } from '../../../../src/toolkit/layout/apply-positions.js';
import { layoutTabWithElkCore, resolveElkLayoutOpts } from '../../../../src/toolkit/layout/elk.js';
import { layoutFlowsWithDagre } from '../../../../src/toolkit/layout/dagre.js';
import { flowMetrics, stripPositions } from '../../../../src/toolkit/layout/layout-metrics.js';
import {
  commentPileOffenders,
  offCanvasGroupOffenders,
} from '../../../../src/toolkit/lint/layout-acceptance.js';
import { layoutLint, type LayoutLintReport } from '../../../../src/toolkit/lint/layout-lint.js';
import { lintFlows } from '../../../../src/toolkit/lint/flows-lint.js';
import {
  EDITOR_GEOMETRY_PROFILE,
  editorGeometryProvider,
} from '../../../../src/toolkit/render/metrics.js';
import type { Diagnostic } from '../../../../src/toolkit/validate/index.js';

const E2_TAB = 'e2spag001';

interface Thresholds {
  readonly r4_separation: R4Separation;
}

interface R4Separation {
  readonly score_ordering_margin: number;
  readonly spag_raw: {
    readonly 'layout-backward-wires': { readonly offender_count: number };
    readonly 'layout-wire-crossings': { readonly minimum_offender_count: number };
  };
  readonly engine_outputs: {
    readonly 'layout-group-overlap': { readonly minimum_offender_count: number };
    readonly 'comment-pile': { readonly offender_count: number };
    readonly 'off-canvas-groups': { readonly offender_count: number };
    readonly 'layout-error-lane-below': { readonly fires: true };
  };
  readonly e1_agent: {
    readonly occlusion: {
      readonly maximum_offender_count: number;
      readonly maximum_severity: 'info' | 'warning' | 'error';
    };
    readonly f11_true_positives_expected: boolean;
  };
}

function thresholds(): R4Separation {
  const raw = readFileSync(
    new URL('../../../../eval/benchmark/thresholds.json', import.meta.url),
    'utf8',
  );
  return (JSON.parse(raw) as Thresholds).r4_separation;
}

function fixtureFlows(name: 'e1-flows.json' | 'e2-flows.json'): FlowsJson {
  const loaded = loadAudit20260610FixtureJson(name);
  if (typeof loaded !== 'object' || loaded === null || !('flows' in loaded)) {
    throw new Error(`${name} did not load as a flows envelope`);
  }
  return FlowsJsonSchema.parse(loaded.flows);
}

function rule(report: LayoutLintReport, id: string) {
  const found = report.rules.find((candidate) => candidate.rule === id);
  if (found === undefined) throw new Error(`missing layout lint rule ${id}`);
  return found;
}

function nonInfoDiagnostics(report: LayoutLintReport): readonly Diagnostic[] {
  return report.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info');
}

function severityRank(severity: Diagnostic['severity']): number {
  return { info: 0, warning: 1, error: 2 }[severity];
}

async function bareElkWithoutGroupCompounds(spec: AuthoringSpec): Promise<AuthoringSpec> {
  const resolved = resolveElkLayoutOpts();
  const tabs: TabSpec[] = [];
  for (const tab of spec.tabs) {
    // D-7 wants the audit-era raw ELK class, not the fixed two-level wrapper:
    // nodes/junctions laid out by bare ELK, with groups/comments stranded.
    const core = await layoutTabWithElkCore({ ...tab, groups: [], comments: [] }, resolved);
    tabs.push(
      core === undefined
        ? tab
        : applyPositions(tab, core.centerByKey, core.dimensionsByKey, {
            bounds: resolved.bounds,
            grid: resolved.grid,
          }),
    );
  }
  return { ...spec, tabs };
}

function regenerateE1Dagre(e1Agent: FlowsJson): FlowsJson {
  const stripped = decompile(stripPositions(e1Agent));
  return compile(layoutFlowsWithDagre(stripped), { prior: e1Agent }).flows;
}

async function regenerateE1Elk(e1Agent: FlowsJson): Promise<FlowsJson> {
  const stripped = decompile(stripPositions(e1Agent));
  return compile(await bareElkWithoutGroupCompounds(stripped), { prior: e1Agent }).flows;
}

describe('D-7 R4 separation acceptance', () => {
  it('uses the frozen editor geometry provider identity for calibrated pins', () => {
    expect(EDITOR_GEOMETRY_PROFILE).toBe('nodered-4.1');
    expect(editorGeometryProvider.profile).toBe(EDITOR_GEOMETRY_PROFILE);
  });

  it('separates the hand-arranged fixture from raw engine and spaghetti fixtures', async () => {
    const r4 = thresholds();
    const e1Agent = fixtureFlows('e1-flows.json');
    const e1Dagre = regenerateE1Dagre(e1Agent);
    const e1Elk = await regenerateE1Elk(e1Agent);
    const spagRaw = fixtureFlows('e2-flows.json');

    const reports = {
      e1Agent: layoutLint(e1Agent),
      e1Dagre: layoutLint(e1Dagre),
      e1Elk: layoutLint(e1Elk),
      spagRaw: layoutLint(spagRaw),
    } as const;

    for (const degraded of [reports.e1Dagre, reports.e1Elk, reports.spagRaw]) {
      expect(reports.e1Agent.overall).toBeGreaterThan(degraded.overall + r4.score_ordering_margin);
      expect(nonInfoDiagnostics(degraded).length).toBeGreaterThan(0);
      expect(degraded.overall).not.toBe(reports.e1Agent.overall);
    }
  });

  it('pins the frozen per-fixture R4 offender expectations', async () => {
    const r4 = thresholds();
    const e1Agent = fixtureFlows('e1-flows.json');
    const e1Dagre = regenerateE1Dagre(e1Agent);
    const e1Elk = await regenerateE1Elk(e1Agent);
    const spagRaw = fixtureFlows('e2-flows.json');
    const spagMetrics = flowMetrics(spagRaw, E2_TAB);
    const engineReports = [layoutLint(e1Dagre), layoutLint(e1Elk)] as const;

    // The R4 raw-spaghetti count is the audit e4-probe centerline metric.
    // The editor-port layoutLint first-benchmark count is frozen separately.
    expect(spagMetrics.backwardWires).toBe(r4.spag_raw['layout-backward-wires'].offender_count);
    expect(spagMetrics.straightLineCrossings).toBeGreaterThanOrEqual(
      r4.spag_raw['layout-wire-crossings'].minimum_offender_count,
    );
    expect(nonInfoDiagnostics(layoutLint(spagRaw)).length).toBeGreaterThan(0);

    for (const report of engineReports) {
      expect(rule(report, 'layout-group-overlap').offenders.length).toBeGreaterThanOrEqual(
        r4.engine_outputs['layout-group-overlap'].minimum_offender_count,
      );
      if (r4.engine_outputs['layout-error-lane-below'].fires) {
        expect(rule(report, 'layout-error-lane-below').offenders.length).toBeGreaterThan(0);
      }
    }

    for (const flows of [e1Dagre, e1Elk]) {
      expect(commentPileOffenders(flows)).toHaveLength(
        r4.engine_outputs['comment-pile'].offender_count,
      );
    }
    // Dagre keeps groups on-canvas for this fixture; the frozen count is the
    // audit-era bare-ELK derivative, which strands exactly two group boxes.
    expect(offCanvasGroupOffenders(e1Elk)).toHaveLength(
      r4.engine_outputs['off-canvas-groups'].offender_count,
    );
  });

  it('keeps the e1-agent occlusion carve-out warning-only and below the frozen cap', () => {
    const r4 = thresholds();
    const e1Agent = fixtureFlows('e1-flows.json');
    const occlusion = lintFlows(e1Agent).diagnostics.filter(
      (diagnostic) => diagnostic.rule === 'bbox-overlap',
    );

    // F11 recorded three real audit-era editor overlaps. The frozen D-7 gate is
    // a <=3/<=warning honesty carve-out; this committed fixture currently
    // measures 0 with the editor-true provider, so this is not an exact-count pin.
    expect(r4.e1_agent.f11_true_positives_expected).toBe(true);
    expect(occlusion.length).toBeLessThanOrEqual(r4.e1_agent.occlusion.maximum_offender_count);
    expect(
      occlusion.every(
        (diagnostic) =>
          severityRank(diagnostic.severity) <= severityRank(r4.e1_agent.occlusion.maximum_severity),
      ),
    ).toBe(true);
  });
});
