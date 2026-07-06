import { hasCanvasPosition, type FlowsJson } from '../../shared/flows-json.js';
import type { RuntimeCapabilities } from '../../adapters/nodered/capabilities.js';
import type { NamingContract } from '../naming/schema.js';
import {
  runValidators,
  type Diagnostic,
  type ValidateOptions,
  type ValidationReport,
} from '../validate/index.js';
import { buildReport } from '../validate/report.js';

import {
  centeredRect,
  collectLayoutGeometry,
  rectHeight,
  rectWidth,
  rectWithin,
  rectsOverlap,
  type LayoutObject,
  type Rect,
} from './geometry.js';
import { layoutLint, type LayoutLintReport } from './layout-lint.js';

export interface LintOptions {
  labelCap?: number;
  grid?: number;
  canvasMaxX?: number;
  canvasMaxY?: number;
  /** Deprecated compatibility override for overlap boxes; defaults use editor geometry. */
  nodeWidth?: number;
  /** Deprecated compatibility override for overlap boxes; defaults use editor geometry. */
  nodeHeight?: number;
  /** Future viewport option; accepted here for stage-pipeline pass-through. */
  lintViewportWindowWidth?: number;
  /** Include v1.5 additive scored layout lint diagnostics and summary. */
  layout?: boolean;
  namingContract?: NamingContract;
  runtime?: RuntimeCapabilities;
}

export interface LayoutRuleScoreSummary {
  rule: string;
  score: number;
  weight: number;
  offender_count: number;
  offenders: Array<Readonly<Record<string, unknown>>>;
}

export interface LayoutScoreSummary {
  overall: number;
  rules: LayoutRuleScoreSummary[];
}

export interface FlowLintReport extends ValidationReport {
  readonly layout?: LayoutScoreSummary;
}

export const DEFAULTS = {
  canvasMaxX: 2400,
  canvasMaxY: 1600,
} as const;

const RULE_OFF_CANVAS = 'off-canvas';
const RULE_BBOX_OVERLAP = 'bbox-overlap';
const LAYOUT_OFFENDER_LIMIT = 10;

function summarizeLayout(report: LayoutLintReport): LayoutScoreSummary {
  return {
    overall: report.overall,
    rules: report.rules.map((r) => ({
      rule: r.rule,
      score: r.score,
      weight: r.weight,
      offender_count: r.offenders.length,
      offenders: r.offenders.slice(0, LAYOUT_OFFENDER_LIMIT),
    })),
  };
}

function nonBlockingLayoutDiagnostics(report: LayoutLintReport): Diagnostic[] {
  return report.diagnostics.map((d) =>
    d.severity === 'error'
      ? {
          ...d,
          severity: 'warning' as const,
        }
      : d,
  );
}

function boxForOverlap(object: LayoutObject, opts: LintOptions): Rect {
  const w = opts.nodeWidth ?? rectWidth(object.box);
  const h = opts.nodeHeight ?? rectHeight(object.box);
  if (w === rectWidth(object.box) && h === rectHeight(object.box)) return object.box;
  return centeredRect(object.center, w, h);
}

export function lintFlows(flows: FlowsJson, opts: LintOptions = {}): FlowLintReport {
  const validateOpts: ValidateOptions = {};
  if (opts.labelCap !== undefined) validateOpts.labelCap = opts.labelCap;
  if (opts.grid !== undefined) validateOpts.grid = opts.grid;
  if (opts.namingContract !== undefined) validateOpts.namingContract = opts.namingContract;
  if (opts.runtime !== undefined) validateOpts.runtime = opts.runtime;
  const baseReport = runValidators(flows, validateOpts);
  const diagnostics: Diagnostic[] = [...baseReport.diagnostics];

  const maxX = opts.canvasMaxX ?? DEFAULTS.canvasMaxX;
  const maxY = opts.canvasMaxY ?? DEFAULTS.canvasMaxY;
  const bounds = { x1: 0, y1: 0, x2: maxX, y2: maxY };
  const geometry = collectLayoutGeometry(flows);

  for (const node of flows) {
    if (!hasCanvasPosition(node)) continue;
    const z = (node as { z?: string }).z;
    const object = geometry.objects.get(node.id);
    if (node.type === 'group' || node.type === 'comment') {
      if (object !== undefined && !rectWithin(object.box, bounds)) {
        diagnostics.push({
          severity: 'warning',
          rule: RULE_OFF_CANVAS,
          message: `Canvas object '${node.id}' bounding box is off-canvas (bounds 0..${maxX} × 0..${maxY}).`,
          nodeId: node.id,
          ...(typeof z === 'string' ? { tabId: z } : {}),
          context: { box: object.box, maxX, maxY },
        });
      }
      continue;
    }
    if (node.x < 0 || node.y < 0 || node.x > maxX || node.y > maxY) {
      diagnostics.push({
        severity: 'error',
        rule: RULE_OFF_CANVAS,
        message: `Node '${node.id}' position (${node.x}, ${node.y}) is off-canvas (bounds 0..${maxX} × 0..${maxY}).`,
        nodeId: node.id,
        ...(typeof z === 'string' ? { tabId: z } : {}),
        context: { x: node.x, y: node.y, maxX, maxY },
      });
    }
    if (object === undefined) continue;
  }

  const overlapObjects = [...geometry.objects.values()].filter(
    (object) => object.kind === 'node' || object.kind === 'junction',
  );
  for (let i = 0; i < overlapObjects.length; i++) {
    const a = overlapObjects[i]!;
    const aBox = boxForOverlap(a, opts);
    for (let j = i + 1; j < overlapObjects.length; j++) {
      const b = overlapObjects[j]!;
      if (a.tabId !== b.tabId) continue;
      const bBox = boxForOverlap(b, opts);
      if (rectsOverlap(aBox, bBox)) {
        diagnostics.push({
          severity: 'warning',
          rule: RULE_BBOX_OVERLAP,
          message: `Nodes '${a.id}' and '${b.id}' have overlapping bounding boxes.`,
          nodeId: a.id,
          tabId: a.tabId,
          context: {
            other: b.id,
            a: { x1: aBox.x1, y1: aBox.y1 },
            b: { x1: bBox.x1, y1: bBox.y1 },
          },
        });
      }
    }
  }

  if (opts.layout !== true) return buildReport(diagnostics);

  const layoutReport = layoutLint(flows, {
    ...(opts.lintViewportWindowWidth !== undefined
      ? { viewportWindowWidth: opts.lintViewportWindowWidth }
      : {}),
  });
  diagnostics.push(...nonBlockingLayoutDiagnostics(layoutReport));

  return {
    ...buildReport(diagnostics),
    layout: summarizeLayout(layoutReport),
  };
}
