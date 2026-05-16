import { hasCanvasPosition, type FlowsJson } from '../../shared/flows-json.js';
import type { NamingContract } from '../naming/schema.js';
import { runValidators, type Diagnostic, type ValidationReport } from '../validate/index.js';
import { buildReport } from '../validate/report.js';

export interface LintOptions {
  labelCap?: number;
  grid?: number;
  canvasMaxX?: number;
  canvasMaxY?: number;
  /** Approximate node bbox dimensions used for overlap checks. */
  nodeWidth?: number;
  nodeHeight?: number;
  namingContract?: NamingContract;
}

export const DEFAULTS = {
  canvasMaxX: 2400,
  canvasMaxY: 1600,
  nodeWidth: 120,
  nodeHeight: 40,
} as const;

const RULE_OFF_CANVAS = 'off-canvas';
const RULE_BBOX_OVERLAP = 'bbox-overlap';

interface Bbox {
  id: string;
  z: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function bboxOf(
  node: { id: string; z?: string; x: number; y: number },
  width: number,
  height: number,
): Bbox {
  return {
    id: node.id,
    z: node.z ?? '',
    x1: node.x,
    y1: node.y,
    x2: node.x + width,
    y2: node.y + height,
  };
}

function bboxOverlaps(a: Bbox, b: Bbox): boolean {
  if (a.z !== b.z) return false;
  if (a.x2 <= b.x1 || b.x2 <= a.x1) return false;
  if (a.y2 <= b.y1 || b.y2 <= a.y1) return false;
  return true;
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
  const w = opts.nodeWidth ?? DEFAULTS.nodeWidth;
  const h = opts.nodeHeight ?? DEFAULTS.nodeHeight;

  const bboxes: Bbox[] = [];
  for (const node of flows) {
    if (!hasCanvasPosition(node)) continue;
    if (node.type === 'group' || node.type === 'comment') continue;
    const z = (node as { z?: string }).z;
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
    bboxes.push(
      bboxOf({ id: node.id, ...(typeof z === 'string' ? { z } : {}), x: node.x, y: node.y }, w, h),
    );
  }

  for (let i = 0; i < bboxes.length; i++) {
    const a = bboxes[i]!;
    for (let j = i + 1; j < bboxes.length; j++) {
      const b = bboxes[j]!;
      if (bboxOverlaps(a, b)) {
        diagnostics.push({
          severity: 'warning',
          rule: RULE_BBOX_OVERLAP,
          message: `Nodes '${a.id}' and '${b.id}' have overlapping bounding boxes.`,
          nodeId: a.id,
          tabId: a.z,
          context: { other: b.id, a: { x1: a.x1, y1: a.y1 }, b: { x1: b.x1, y1: b.y1 } },
        });
      }
    }
  }

  return buildReport(diagnostics);
}
