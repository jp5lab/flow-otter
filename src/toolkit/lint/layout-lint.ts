import type { FlowsJson } from '../../shared/flows-json.js';
import type { GeometryProvider } from '../render/metrics.js';
import type { Diagnostic } from '../validate/index.js';

import {
  collectLayoutGeometry,
  rectWidth,
  rectsOverlap,
  unionRect,
  type LayoutGeometry,
  type LayoutObject,
  type LayoutWire,
  type Point,
  type Rect,
} from './geometry.js';

const RULE_STAGE_ORDER = 'layout-stage-order';
const RULE_GROUP_OVERLAP = 'layout-group-overlap';
const RULE_HEADER_PRESENCE = 'layout-header-presence';
const RULE_ERROR_LANE_BELOW = 'layout-error-lane-below';
const RULE_AFFIRMATIVE_ON_TOP = 'layout-affirmative-on-top';
const RULE_WIRE_CROSSINGS = 'layout-wire-crossings';
const RULE_BACKWARD_WIRES = 'layout-backward-wires';
const RULE_VIEWPORT_OVERFLOW = 'layout-viewport-overflow';

const DEFAULT_VIEWPORT_WINDOW_WIDTH = 1920;
const EDITOR_CHROME_WIDTH = 500;
const BACKWARD_TOLERANCE_PX = 20;
const WIRE_FLATTEN_SEGMENTS = 8;
const EPSILON = 1e-9;

export type LayoutRuleId =
  | typeof RULE_STAGE_ORDER
  | typeof RULE_GROUP_OVERLAP
  | typeof RULE_HEADER_PRESENCE
  | typeof RULE_ERROR_LANE_BELOW
  | typeof RULE_AFFIRMATIVE_ON_TOP
  | typeof RULE_WIRE_CROSSINGS
  | typeof RULE_BACKWARD_WIRES
  | typeof RULE_VIEWPORT_OVERFLOW;

export interface LayoutLintOptions {
  readonly geometryProvider?: GeometryProvider;
  readonly viewportWindowWidth?: number;
}

export interface LayoutLintRuleResult {
  readonly rule: LayoutRuleId;
  readonly score: number;
  readonly weight: number;
  readonly offenders: readonly Readonly<Record<string, unknown>>[];
}

export interface LayoutLintReport {
  readonly overall: number;
  readonly rules: readonly LayoutLintRuleResult[];
  readonly diagnostics: readonly Diagnostic[];
}

interface RuleEvaluation extends LayoutLintRuleResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly abstain?: boolean;
}

interface RuleDefinition {
  readonly id: LayoutRuleId;
  readonly weight: number;
  evaluate(geometry: LayoutGeometry, opts: RequiredLayoutLintOptions): RuleEvaluation;
}

interface RequiredLayoutLintOptions {
  readonly viewportWindowWidth: number;
}

interface FlattenedWire {
  readonly wire: LayoutWire;
  readonly points: readonly Point[];
  readonly box: Rect;
}

function scoreFrom(offenderCount: number, opportunityCount: number): number {
  if (offenderCount === 0) return 1;
  return Math.max(0, 1 - offenderCount / Math.max(1, opportunityCount));
}

function abstainingRule(id: LayoutRuleId, weight: number): RuleDefinition {
  return {
    id,
    weight,
    evaluate: () => ({
      rule: id,
      score: 1,
      weight,
      offenders: [],
      diagnostics: [
        {
          severity: 'info',
          rule: id,
          message: 'Rule not yet implemented (D-2); excluded from weighted layout score.',
        },
      ],
      abstain: true,
    }),
  };
}

function cubicPoint(from: Point, to: Point, t: number): Point {
  const dx = (to.x - from.x) / 2;
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  const mt = 1 - t;
  return {
    x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x,
    y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y,
  };
}

function rectOfPoints(points: readonly Point[]): Rect {
  let box: Rect | undefined;
  for (const p of points) {
    box = unionRect(box, { x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  }
  return box ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function flattenWire(wire: LayoutWire): FlattenedWire {
  const points: Point[] = [];
  for (let i = 0; i <= WIRE_FLATTEN_SEGMENTS; i++) {
    points.push(cubicPoint(wire.from, wire.to, i / WIRE_FLATTEN_SEGMENTS));
  }
  return { wire, points, box: rectOfPoints(points) };
}

function endpointShared(a: LayoutWire, b: LayoutWire): boolean {
  const sameSource = a.sourceId === b.sourceId && a.sourcePort === b.sourcePort;
  const sameTarget = a.targetId === b.targetId;
  const sameNodePoint =
    (a.from.nodeId === b.to.nodeId && a.from.x === b.to.x && a.from.y === b.to.y) ||
    (a.to.nodeId === b.from.nodeId && a.to.x === b.from.x && a.to.y === b.from.y);
  return sameSource || sameTarget || sameNodePoint;
}

function segmentBox(a: Point, b: Point): Rect {
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  };
}

function rectsTouchOrOverlap(a: Rect, b: Rect): boolean {
  if (a.x2 < b.x1 || b.x2 < a.x1) return false;
  if (a.y2 < b.y1 || b.y2 < a.y1) return false;
  return true;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a.x, b.x) - EPSILON <= c.x &&
    c.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.y, b.y) - EPSILON <= c.y &&
    c.y <= Math.max(a.y, b.y) + EPSILON
  );
}

function isZero(n: number): boolean {
  return Math.abs(n) <= EPSILON;
}

function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  if (!rectsTouchOrOverlap(segmentBox(a1, a2), segmentBox(b1, b2))) return false;

  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (isZero(o1) && isZero(o2) && isZero(o3) && isZero(o4)) return false;
  if (isZero(o1) && onSegment(a1, a2, b1)) return true;
  if (isZero(o2) && onSegment(a1, a2, b2)) return true;
  if (isZero(o3) && onSegment(b1, b2, a1)) return true;
  if (isZero(o4) && onSegment(b1, b2, a2)) return true;
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

function wiresCross(a: FlattenedWire, b: FlattenedWire): boolean {
  if (!rectsTouchOrOverlap(a.box, b.box)) return false;
  for (let i = 0; i < a.points.length - 1; i++) {
    const a1 = a.points[i]!;
    const a2 = a.points[i + 1]!;
    const aBox = segmentBox(a1, a2);
    for (let j = 0; j < b.points.length - 1; j++) {
      const b1 = b.points[j]!;
      const b2 = b.points[j + 1]!;
      if (!rectsTouchOrOverlap(aBox, segmentBox(b1, b2))) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function wireCrossingsRule(): RuleDefinition {
  return {
    id: RULE_WIRE_CROSSINGS,
    weight: 3,
    evaluate: (geometry) => {
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      let opportunities = 0;

      // O(W^2 * K^2): every wire pair, after wire-level and segment-level
      // AABB prefilters, compares at most K flattened segments per wire.
      for (const tab of geometry.tabs.values()) {
        const flattened = tab.wires.map(flattenWire);
        for (let i = 0; i < flattened.length; i++) {
          const a = flattened[i]!;
          for (let j = i + 1; j < flattened.length; j++) {
            const b = flattened[j]!;
            if (endpointShared(a.wire, b.wire)) continue;
            opportunities++;
            if (!wiresCross(a, b)) continue;
            const offender = {
              tabId: tab.tabId,
              ids: [a.wire.id, b.wire.id],
              sources: [a.wire.sourceId, b.wire.sourceId],
              targets: [a.wire.targetId, b.wire.targetId],
            };
            offenders.push(offender);
            diagnostics.push({
              severity: 'warning',
              rule: RULE_WIRE_CROSSINGS,
              message: `Wires '${a.wire.id}' and '${b.wire.id}' cross on tab '${tab.tabId}'.`,
              tabId: tab.tabId,
              context: offender,
            });
          }
        }
      }

      return {
        rule: RULE_WIRE_CROSSINGS,
        score: scoreFrom(offenders.length, opportunities),
        weight: 3,
        offenders,
        diagnostics,
      };
    },
  };
}

function backwardWiresRule(): RuleDefinition {
  return {
    id: RULE_BACKWARD_WIRES,
    weight: 3,
    evaluate: (geometry) => {
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      let opportunities = 0;

      for (const tab of geometry.tabs.values()) {
        for (const wire of tab.wires) {
          opportunities++;
          const delta = wire.from.x - wire.to.x;
          if (delta <= BACKWARD_TOLERANCE_PX) continue;
          const offender = {
            tabId: tab.tabId,
            wireId: wire.id,
            sourceId: wire.sourceId,
            targetId: wire.targetId,
            sourcePortX: wire.from.x,
            targetPortX: wire.to.x,
            tolerancePx: BACKWARD_TOLERANCE_PX,
          };
          offenders.push(offender);
          diagnostics.push({
            severity: 'warning',
            rule: RULE_BACKWARD_WIRES,
            message: `Wire '${wire.id}' runs backward by ${delta}px on tab '${tab.tabId}'.`,
            tabId: tab.tabId,
            nodeId: wire.sourceId,
            context: offender,
          });
        }
      }

      return {
        rule: RULE_BACKWARD_WIRES,
        score: scoreFrom(offenders.length, opportunities),
        weight: 3,
        offenders,
        diagnostics,
      };
    },
  };
}

function siblingKey(group: LayoutObject): string {
  return `${group.tabId}\u0000${group.parentGroupId ?? ''}`;
}

function groupOverlapRule(): RuleDefinition {
  return {
    id: RULE_GROUP_OVERLAP,
    weight: 2,
    evaluate: (geometry) => {
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      let opportunities = 0;

      for (const tab of geometry.tabs.values()) {
        for (let i = 0; i < tab.groups.length; i++) {
          const a = tab.groups[i]!;
          for (let j = i + 1; j < tab.groups.length; j++) {
            const b = tab.groups[j]!;
            if (siblingKey(a) !== siblingKey(b)) continue;
            opportunities++;
            if (!rectsOverlap(a.box, b.box)) continue;
            const offender = { tabId: tab.tabId, ids: [a.id, b.id] };
            offenders.push(offender);
            diagnostics.push({
              severity: 'warning',
              rule: RULE_GROUP_OVERLAP,
              message: `Sibling groups '${a.id}' and '${b.id}' overlap on tab '${tab.tabId}'.`,
              tabId: tab.tabId,
              nodeId: a.id,
              context: offender,
            });
          }
        }
      }

      return {
        rule: RULE_GROUP_OVERLAP,
        score: scoreFrom(offenders.length, opportunities),
        weight: 2,
        offenders,
        diagnostics,
      };
    },
  };
}

function viewportOverflowRule(): RuleDefinition {
  return {
    id: RULE_VIEWPORT_OVERFLOW,
    weight: 1,
    evaluate: (geometry, opts) => {
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      const usableWidth = Math.max(1, opts.viewportWindowWidth - EDITOR_CHROME_WIDTH);
      let opportunities = 0;

      for (const tab of geometry.tabs.values()) {
        const box = tab.contentBox;
        if (box === undefined) continue;
        opportunities++;
        const width = rectWidth(box);
        if (width <= usableWidth) continue;
        const offender = {
          tabId: tab.tabId,
          extentWidth: width,
          usableViewportWidth: usableWidth,
          windowWidth: opts.viewportWindowWidth,
        };
        offenders.push(offender);
        diagnostics.push({
          severity: 'info',
          rule: RULE_VIEWPORT_OVERFLOW,
          message: `Tab '${tab.tabId}' content extent ${width}px exceeds usable viewport width ${usableWidth}px.`,
          tabId: tab.tabId,
          context: offender,
        });
      }

      return {
        rule: RULE_VIEWPORT_OVERFLOW,
        score: scoreFrom(offenders.length, opportunities),
        weight: 1,
        offenders,
        diagnostics,
      };
    },
  };
}

const RULES: readonly RuleDefinition[] = [
  abstainingRule(RULE_STAGE_ORDER, 2),
  groupOverlapRule(),
  abstainingRule(RULE_HEADER_PRESENCE, 1),
  abstainingRule(RULE_ERROR_LANE_BELOW, 2),
  abstainingRule(RULE_AFFIRMATIVE_ON_TOP, 1),
  wireCrossingsRule(),
  backwardWiresRule(),
  viewportOverflowRule(),
];

export function layoutLint(flows: FlowsJson, opts: LayoutLintOptions = {}): LayoutLintReport {
  const geometry = collectLayoutGeometry(flows, {
    ...(opts.geometryProvider !== undefined ? { geometryProvider: opts.geometryProvider } : {}),
  });
  const required: RequiredLayoutLintOptions = {
    viewportWindowWidth: opts.viewportWindowWidth ?? DEFAULT_VIEWPORT_WINDOW_WIDTH,
  };
  const evaluations = RULES.map((r) => r.evaluate(geometry, required));
  let numerator = 0;
  let denominator = 0;
  for (const r of evaluations) {
    if (r.abstain === true) continue;
    numerator += r.weight * (1 - r.score);
    denominator += r.weight;
  }
  const overall = denominator === 0 ? 1 : 1 - numerator / denominator;

  return {
    overall,
    rules: evaluations.map((r) => ({
      rule: r.rule,
      score: r.score,
      weight: r.weight,
      offenders: r.offenders,
    })),
    diagnostics: evaluations.flatMap((r) => r.diagnostics),
  };
}
