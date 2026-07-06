import {
  isComment,
  isGroup,
  type FlowsJson,
  type FlowsJsonNode,
  type GroupNode,
} from '../../shared/flows-json.js';
import { deriveFlowsJsonLanes } from '../lanes.js';
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
  evaluate(
    flows: FlowsJson,
    geometry: LayoutGeometry,
    opts: RequiredLayoutLintOptions,
  ): RuleEvaluation;
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

function abstain(id: LayoutRuleId, weight: number, message: string): RuleEvaluation {
  return {
    rule: id,
    score: 1,
    weight,
    offenders: [],
    diagnostics: [
      {
        severity: 'info',
        rule: id,
        message,
      },
    ],
    abstain: true,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function authoringKeyOf(node: FlowsJsonNode): string | undefined {
  const key = (node as { _authoringKey?: unknown })._authoringKey;
  return typeof key === 'string' ? key : undefined;
}

function named(node: FlowsJsonNode): boolean {
  const name = (node as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() !== '';
}

function headerTargetOf(node: FlowsJsonNode): string | undefined {
  const record = node as { _authoringHeaderFor?: unknown; headerFor?: unknown };
  if (typeof record._authoringHeaderFor === 'string') return record._authoringHeaderFor;
  if (typeof record.headerFor === 'string') return record.headerFor;
  return undefined;
}

function horizontalOverlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
}

interface FlowFacts {
  readonly nodesById: ReadonlyMap<string, FlowsJsonNode>;
  readonly groupMembersById: ReadonlyMap<string, ReadonlySet<string>>;
  readonly groupIdByMemberId: ReadonlyMap<string, string>;
  readonly commentsByTabId: ReadonlyMap<string, readonly FlowsJsonNode[]>;
}

function zOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function flowFacts(flows: FlowsJson): FlowFacts {
  const nodesById = new Map<string, FlowsJsonNode>();
  const groupMembersById = new Map<string, Set<string>>();
  const groupIdByMemberId = new Map<string, string>();
  const commentsByTabId = new Map<string, FlowsJsonNode[]>();

  for (const node of flows) {
    nodesById.set(node.id, node);
    if (isGroup(node)) {
      const members = new Set<string>();
      for (const id of node.nodes) members.add(id);
      groupMembersById.set(node.id, members);
      for (const id of members) groupIdByMemberId.set(id, node.id);
    }
  }

  for (const node of flows) {
    const groupId = (node as { g?: unknown }).g;
    if (typeof groupId === 'string') {
      let members = groupMembersById.get(groupId);
      if (members === undefined) {
        members = new Set();
        groupMembersById.set(groupId, members);
      }
      members.add(node.id);
      groupIdByMemberId.set(node.id, groupId);
    }
    if (isComment(node)) {
      const tabId = zOf(node);
      if (tabId === undefined) continue;
      const comments = commentsByTabId.get(tabId);
      if (comments === undefined) commentsByTabId.set(tabId, [node]);
      else comments.push(node);
    }
  }

  return { nodesById, groupMembersById, groupIdByMemberId, commentsByTabId };
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
    evaluate: (_flows, geometry) => {
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
    evaluate: (_flows, geometry) => {
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
    evaluate: (_flows, geometry) => {
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
    evaluate: (_flows, geometry, opts) => {
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

function errorLaneBelowRule(): RuleDefinition {
  return {
    id: RULE_ERROR_LANE_BELOW,
    weight: 2,
    evaluate: (flows, geometry) => {
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      const lanesByTab = deriveFlowsJsonLanes(flows);
      let opportunities = 0;

      for (const tab of geometry.tabs.values()) {
        const lanes = lanesByTab.get(tab.tabId)?.lanesById;
        if (lanes === undefined) continue;
        const mainYs: number[] = [];
        const errorYs: number[] = [];
        for (const object of tab.objects.values()) {
          const lane = lanes.get(object.id);
          if (lane === 'main') mainYs.push(object.center.y);
          else if (lane === 'error') errorYs.push(object.center.y);
        }
        if (mainYs.length === 0 || errorYs.length === 0) continue;
        opportunities++;
        const mainMedianY = median(mainYs);
        const errorMedianY = median(errorYs);
        if (errorMedianY > mainMedianY) continue;
        const offender = { tabId: tab.tabId, mainMedianY, errorMedianY };
        offenders.push(offender);
        diagnostics.push({
          severity: 'warning',
          rule: RULE_ERROR_LANE_BELOW,
          message: `Tab '${tab.tabId}' error lane median y ${errorMedianY}px is not below main lane median y ${mainMedianY}px.`,
          tabId: tab.tabId,
          context: offender,
        });
      }

      if (opportunities === 0) {
        return abstain(
          RULE_ERROR_LANE_BELOW,
          2,
          'No tab has both inferred main-lane and error-lane nodes; excluded from weighted layout score.',
        );
      }

      return {
        rule: RULE_ERROR_LANE_BELOW,
        score: scoreFrom(offenders.length, opportunities),
        weight: 2,
        offenders,
        diagnostics,
      };
    },
  };
}

function groupCentroidX(
  tab: LayoutGeometry['tabs'] extends ReadonlyMap<string, infer T> ? T : never,
  group: LayoutObject,
  memberIds: ReadonlySet<string> | undefined,
): number {
  const memberXs: number[] = [];
  for (const id of memberIds ?? []) {
    const member = tab.objects.get(id);
    if (member !== undefined && member.kind !== 'group') memberXs.push(member.center.x);
  }
  return memberXs.length > 0 ? mean(memberXs) : group.center.x;
}

function stageOrderRule(): RuleDefinition {
  return {
    id: RULE_STAGE_ORDER,
    weight: 2,
    evaluate: (flows, geometry) => {
      const facts = flowFacts(flows);
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      let hasAnyGroup = false;
      let opportunities = 0;

      for (const tab of geometry.tabs.values()) {
        if (tab.groups.length > 0) hasAnyGroup = true;
        const centroids = new Map<string, number>();
        for (const group of tab.groups) {
          centroids.set(group.id, groupCentroidX(tab, group, facts.groupMembersById.get(group.id)));
        }

        const seenEdges = new Set<string>();
        for (const wire of tab.wires) {
          const fromGroupId =
            facts.groupIdByMemberId.get(wire.sourceId) ??
            tab.objects.get(wire.sourceId)?.parentGroupId;
          const toGroupId =
            facts.groupIdByMemberId.get(wire.targetId) ??
            tab.objects.get(wire.targetId)?.parentGroupId;
          if (fromGroupId === undefined || toGroupId === undefined || fromGroupId === toGroupId) {
            continue;
          }
          if (!centroids.has(fromGroupId) || !centroids.has(toGroupId)) continue;
          const edgeKey = `${fromGroupId}\u0000${toGroupId}`;
          if (seenEdges.has(edgeKey)) continue;
          seenEdges.add(edgeKey);
          opportunities++;
          const fromCentroidX = centroids.get(fromGroupId)!;
          const toCentroidX = centroids.get(toGroupId)!;
          if (fromCentroidX <= toCentroidX) continue;
          const offender = {
            tabId: tab.tabId,
            fromGroupId,
            toGroupId,
            fromCentroidX,
            toCentroidX,
          };
          offenders.push(offender);
          diagnostics.push({
            severity: 'warning',
            rule: RULE_STAGE_ORDER,
            message: `Inter-group edge '${fromGroupId}' -> '${toGroupId}' runs right-to-left on tab '${tab.tabId}'.`,
            tabId: tab.tabId,
            nodeId: fromGroupId,
            context: offender,
          });
        }
      }

      if (!hasAnyGroup) {
        return abstain(
          RULE_STAGE_ORDER,
          2,
          'No groups are present, so stage order cannot be inferred; excluded from weighted layout score.',
        );
      }
      if (opportunities === 0) {
        return abstain(
          RULE_STAGE_ORDER,
          2,
          'No inter-group DAG edges are present, so stage order cannot be inferred; excluded from weighted layout score.',
        );
      }

      return {
        rule: RULE_STAGE_ORDER,
        score: scoreFrom(offenders.length, opportunities),
        weight: 2,
        offenders,
        diagnostics,
      };
    },
  };
}

function affirmativeOnTopRule(): RuleDefinition {
  return {
    id: RULE_AFFIRMATIVE_ON_TOP,
    weight: 1,
    evaluate: (_flows, geometry) => {
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      let opportunities = 0;

      for (const tab of geometry.tabs.values()) {
        const bySource = new Map<string, Map<number, number[]>>();
        for (const wire of tab.wires) {
          let ports = bySource.get(wire.sourceId);
          if (ports === undefined) {
            ports = new Map();
            bySource.set(wire.sourceId, ports);
          }
          const ys = ports.get(wire.sourcePort);
          if (ys === undefined) ports.set(wire.sourcePort, [wire.to.y]);
          else ys.push(wire.to.y);
        }

        for (const [nodeId, ports] of bySource) {
          const port0Ys = ports.get(0);
          if (port0Ys === undefined || port0Ys.length === 0) continue;
          const port0MeanTargetY = mean(port0Ys);
          for (const [port, ys] of ports) {
            if (port === 0 || ys.length === 0) continue;
            opportunities++;
            const portMeanTargetY = mean(ys);
            if (port0MeanTargetY <= portMeanTargetY) continue;
            const offender = {
              tabId: tab.tabId,
              nodeId,
              port0MeanTargetY,
              comparedPort: port,
              comparedPortMeanTargetY: portMeanTargetY,
            };
            offenders.push(offender);
            diagnostics.push({
              severity: 'warning',
              rule: RULE_AFFIRMATIVE_ON_TOP,
              message: `Node '${nodeId}' output port 0 targets are below port ${port} targets on tab '${tab.tabId}'.`,
              tabId: tab.tabId,
              nodeId,
              context: offender,
            });
          }
        }
      }

      if (opportunities === 0) {
        return abstain(
          RULE_AFFIRMATIVE_ON_TOP,
          1,
          'No multi-output wired nodes have comparable port targets; excluded from weighted layout score.',
        );
      }

      return {
        rule: RULE_AFFIRMATIVE_ON_TOP,
        score: scoreFrom(offenders.length, opportunities),
        weight: 1,
        offenders,
        diagnostics,
      };
    },
  };
}

function hasHeaderComment(
  group: LayoutObject,
  groupNode: GroupNode,
  tab: LayoutGeometry['tabs'] extends ReadonlyMap<string, infer T> ? T : never,
  facts: FlowFacts,
): boolean {
  const groupKey = authoringKeyOf(groupNode);
  for (const commentNode of facts.commentsByTabId.get(group.tabId) ?? []) {
    if (!named(commentNode)) continue;
    const target = headerTargetOf(commentNode);
    if (target !== undefined && (target === group.id || target === groupKey)) return true;
    const commentObject = tab.objects.get(commentNode.id);
    if (commentObject === undefined) continue;
    const aboveGroup = commentObject.box.y2 <= group.box.y1;
    const nearGroup = group.box.y1 - commentObject.box.y2 <= 80;
    if (aboveGroup && nearGroup && horizontalOverlap(commentObject.box, group.box) > 0) return true;
  }
  return false;
}

function headerPresenceRule(): RuleDefinition {
  return {
    id: RULE_HEADER_PRESENCE,
    weight: 1,
    evaluate: (flows, geometry) => {
      const facts = flowFacts(flows);
      const offenders: Array<Readonly<Record<string, unknown>>> = [];
      const diagnostics: Diagnostic[] = [];
      let opportunities = 0;

      for (const tab of geometry.tabs.values()) {
        for (const group of tab.groups) {
          const groupNode = facts.nodesById.get(group.id);
          if (groupNode === undefined || !isGroup(groupNode)) continue;
          const memberCount = facts.groupMembersById.get(group.id)?.size ?? groupNode.nodes.length;
          if (memberCount < 3) continue;
          opportunities++;
          if (named(groupNode) || hasHeaderComment(group, groupNode, tab, facts)) continue;
          const offender = { tabId: tab.tabId, groupId: group.id, memberCount };
          offenders.push(offender);
          diagnostics.push({
            severity: 'warning',
            rule: RULE_HEADER_PRESENCE,
            message: `Group '${group.id}' has ${memberCount} members but no name or header comment on tab '${tab.tabId}'.`,
            tabId: tab.tabId,
            nodeId: group.id,
            context: offender,
          });
        }
      }

      if (opportunities === 0) {
        return abstain(
          RULE_HEADER_PRESENCE,
          1,
          'No groups have at least three members; excluded from weighted layout score.',
        );
      }

      return {
        rule: RULE_HEADER_PRESENCE,
        score: scoreFrom(offenders.length, opportunities),
        weight: 1,
        offenders,
        diagnostics,
      };
    },
  };
}

const RULES: readonly RuleDefinition[] = [
  stageOrderRule(),
  groupOverlapRule(),
  headerPresenceRule(),
  errorLaneBelowRule(),
  affirmativeOnTopRule(),
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
  const evaluations = RULES.map((r) => r.evaluate(flows, geometry, required));
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
