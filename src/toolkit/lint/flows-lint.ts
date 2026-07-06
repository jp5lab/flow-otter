import { hasCanvasPosition, type FlowsJson } from '../../shared/flows-json.js';
import type { NamingContract } from '../naming/schema.js';
import { runValidators, type Diagnostic, type ValidationReport } from '../validate/index.js';
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
  namingContract?: NamingContract;
}

export const DEFAULTS = {
  canvasMaxX: 2400,
  canvasMaxY: 1600,
} as const;

const RULE_OFF_CANVAS = 'off-canvas';
const RULE_BBOX_OVERLAP = 'bbox-overlap';

function boxForOverlap(object: LayoutObject, opts: LintOptions): Rect {
  const w = opts.nodeWidth ?? rectWidth(object.box);
  const h = opts.nodeHeight ?? rectHeight(object.box);
  if (w === rectWidth(object.box) && h === rectHeight(object.box)) return object.box;
  return centeredRect(object.center, w, h);
}

export function lintFlows(flows: FlowsJson, opts: LintOptions = {}): ValidationReport {
  const validateOpts: { labelCap?: number; grid?: number; namingContract?: NamingContract } = {};
  if (opts.labelCap !== undefined) validateOpts.labelCap = opts.labelCap;
  if (opts.grid !== undefined) validateOpts.grid = opts.grid;
  if (opts.namingContract !== undefined) validateOpts.namingContract = opts.namingContract;
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

  return buildReport(diagnostics);
}
