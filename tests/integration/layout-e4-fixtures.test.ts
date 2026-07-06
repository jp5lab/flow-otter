/**
 * LAYO-5 — E4 fixture acceptance over semantic layout properties.
 *
 * Coordinate snapshots are forbidden in this file. These assertions pin
 * relationships, topology metrics, field-class diffs, and viewport budget.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { loadAudit20260610FixtureJson } from '../fixtures/audit-2026-06-10/loader.js';
import {
  FlowsJsonSchema,
  type FlowsJson,
  type FlowsJsonNode,
  type GroupNode,
} from '../../src/shared/flows-json.js';
import { deriveFlowsJsonLanes, LANE_GAP, type Lane } from '../../src/toolkit/lanes.js';
import {
  deriveFlowsJsonSections,
  flowMetrics,
  horizontalOverlap,
  layoutFlowsJson,
  layoutObjectBounds,
  rectContains,
  rectsDisjoint,
  stripLayoutGeometry,
  tabBoundingExtent,
  type FlowMetricPosition,
  type FlowMetricRect,
} from '../../src/toolkit/layout/index.js';
import { SPATIAL_SCAFFOLD_VISIBLE_WIDTH } from '../../src/toolkit/layout/spatial-scaffold.js';

const E1_TAB = 'f6f2187d.f17ca8';
const E1_SWITCH = '3865da1cf3821d01';
const E2_TAB = 'e2spag001';
const E2_SWITCH = 'e2n05';
const E2_JUNCTION = 'e2n12';

interface LayoutDiagnostic {
  readonly severity: string;
  readonly rule: string;
  readonly tabId?: string;
  readonly context?: Record<string, unknown>;
}

function fixtureFlows(name: 'e1-flows.json' | 'e2-flows.json'): FlowsJson {
  const loaded = loadAudit20260610FixtureJson(name);
  if (typeof loaded !== 'object' || loaded === null || !('flows' in loaded)) {
    throw new Error(`${name} did not load as a flows envelope`);
  }
  return FlowsJsonSchema.parse(loaded.flows);
}

function requiredFlows(flows: FlowsJson | undefined, label: string): FlowsJson {
  if (flows === undefined) throw new Error(`${label} was not laid out`);
  return flows;
}

function nodeById(flows: FlowsJson, id: string): FlowsJsonNode {
  const found = flows.find((node) => node.id === id);
  if (found === undefined) throw new Error(`missing node ${id}`);
  return found;
}

function groupNodes(flows: FlowsJson, tabId: string): GroupNode[] {
  return flows.filter(
    (node): node is GroupNode => node.type === 'group' && (node as { z?: unknown }).z === tabId,
  );
}

function wireTargets(node: FlowsJsonNode, port: number): string[] {
  const wires = (node as { wires?: unknown }).wires;
  if (!Array.isArray(wires) || !Array.isArray(wires[port])) return [];
  return wires[port].filter((target): target is string => typeof target === 'string');
}

function firstWireTarget(flows: FlowsJson, nodeId: string, port: number): string {
  const targets = wireTargets(nodeById(flows, nodeId), port);
  if (targets.length !== 1) {
    throw new Error(`expected ${nodeId} port ${port} to have one target, got ${targets.length}`);
  }
  return targets[0]!;
}

function positionOf(
  positions: ReadonlyMap<string, FlowMetricPosition>,
  id: string,
): FlowMetricPosition {
  const position = positions.get(id);
  if (position === undefined) throw new Error(`missing position for ${id}`);
  return position;
}

function boundsOf(flows: FlowsJson, tabId: string, id: string): FlowMetricRect {
  const bounds = layoutObjectBounds(flows, tabId, id);
  if (bounds === undefined) throw new Error(`missing geometry for ${id}`);
  return bounds;
}

function laneIds(flows: FlowsJson, tabId: string, lane: Lane): string[] {
  const derivation = deriveFlowsJsonLanes(flows).get(tabId);
  if (derivation === undefined) throw new Error(`missing lane derivation for ${tabId}`);
  return [...derivation.lanesById.entries()]
    .filter(([, foundLane]) => foundLane === lane)
    .map(([id]) => id);
}

function assertOnlyGeometryChanged(input: FlowsJson, output: FlowsJson): void {
  expect(output.map((node) => node.id)).toEqual(input.map((node) => node.id));
  expect(new Set(output.map((node) => node.id)).size).toBe(input.length);
  expect(stripLayoutGeometry(output)).toEqual(stripLayoutGeometry(input));
}

function assertAffirmativeOnTop(flows: FlowsJson, tabId: string, switchId: string): void {
  const metrics = flowMetrics(flows, tabId);
  const out0 = firstWireTarget(flows, switchId, 0);
  const out1 = firstWireTarget(flows, switchId, 1);
  expect(positionOf(metrics.positions, out0).y).toBeLessThan(positionOf(metrics.positions, out1).y);
}

function widthOverflowDiagnostics(
  diagnostics: readonly LayoutDiagnostic[],
  tabId: string,
): LayoutDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.rule === 'layout/width-overflow' && diagnostic.tabId === tabId,
  );
}

function assertHeaderPlacement(flows: FlowsJson, tabId: string): void {
  const sections = deriveFlowsJsonSections(flows).get(tabId);
  if (sections === undefined) throw new Error(`missing sections for ${tabId}`);
  const headerPairs = [...sections.headerGroupIdByCommentId.entries()];
  expect(headerPairs).toHaveLength(6);

  const metrics = flowMetrics(flows, tabId);
  const seenHeaderPositions = new Set<string>();
  for (const [commentId, groupId] of headerPairs) {
    const header = nodeById(flows, commentId);
    const group = nodeById(flows, groupId);
    expect(header.type).toBe('comment');
    expect(group.type).toBe('group');

    const headerBounds = boundsOf(flows, tabId, commentId);
    const groupBounds = boundsOf(flows, tabId, groupId);
    expect(headerBounds.y2).toBeLessThan(groupBounds.y1);
    expect(horizontalOverlap(headerBounds, groupBounds)).toBeGreaterThan(0);

    const headerPosition = positionOf(metrics.positions, commentId);
    expect(headerPosition).not.toEqual({ x: 0, y: 0 });
    const key = `${headerPosition.x}:${headerPosition.y}`;
    expect(seenHeaderPositions.has(key)).toBe(false);
    seenHeaderPositions.add(key);
  }
}

function assertGroupContainment(flows: FlowsJson, tabId: string): void {
  const groups = groupNodes(flows, tabId);
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const first = groups[i]!;
      const second = groups[j]!;
      if ((first.g ?? '') !== (second.g ?? '')) continue;
      expect(
        rectsDisjoint(boundsOf(flows, tabId, first.id), boundsOf(flows, tabId, second.id)),
      ).toBe(true);
    }
  }

  for (const group of groups) {
    const groupBounds = boundsOf(flows, tabId, group.id);
    for (const memberId of group.nodes) {
      expect(rectContains(groupBounds, boundsOf(flows, tabId, memberId))).toBe(true);
    }
  }
}

function otherTabNodeJson(flows: FlowsJson, tabId: string): string[] {
  return flows
    .filter((node) => node.id === tabId || (node as { z?: unknown }).z === tabId)
    .map((node) => JSON.stringify(node));
}

function e2WithSiblingTab(flows: FlowsJson): FlowsJson {
  return FlowsJsonSchema.parse([
    ...flows,
    { id: 'e2-sibling-tab', type: 'tab', label: 'Untouched sibling' },
    {
      id: 'e2-sibling-fn',
      type: 'function',
      z: 'e2-sibling-tab',
      name: 'Untouched function',
      func: 'return msg;',
      outputs: 1,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      wires: [[]],
      x: 111,
      y: 222,
    },
  ]);
}

describe('LAYO-5 E4 fixture acceptance', () => {
  const e1Input = fixtureFlows('e1-flows.json');
  const e2Input = fixtureFlows('e2-flows.json');
  const e1Diagnostics: LayoutDiagnostic[] = [];
  let e1Output: FlowsJson | undefined;
  let e2Output: FlowsJson | undefined;

  beforeAll(async () => {
    e1Output = await layoutFlowsJson(e1Input, {
      onDiagnostic: (diagnostic) => e1Diagnostics.push(diagnostic),
    });
    e2Output = await layoutFlowsJson(e2Input);
  });

  describe('e1 audit fixture', () => {
    it('relayouts without throwing and changes only geometry fields', () => {
      assertOnlyGeometryChanged(e1Input, requiredFlows(e1Output, 'e1'));
    });

    it('places error-closure nodes strictly below main-lane nodes by at least LANE_GAP', () => {
      const output = requiredFlows(e1Output, 'e1');
      const metrics = flowMetrics(output, E1_TAB);
      const mainYs = laneIds(output, E1_TAB, 'main').map(
        (id) => positionOf(metrics.positions, id).y,
      );
      const errorYs = laneIds(output, E1_TAB, 'error').map(
        (id) => positionOf(metrics.positions, id).y,
      );
      expect(mainYs.length).toBeGreaterThan(0);
      expect(errorYs.length).toBeGreaterThan(0);

      const maxMainY = Math.max(...mainYs);
      const minErrorY = Math.min(...errorYs);
      expect(minErrorY).toBeGreaterThan(maxMainY);
      expect(minErrorY - maxMainY).toBeGreaterThanOrEqual(LANE_GAP);
    });

    it('keeps switch port 0 above port 1', () => {
      assertAffirmativeOnTop(requiredFlows(e1Output, 'e1'), E1_TAB, E1_SWITCH);
    });

    it('places six headers above their groups without overlap at the origin', () => {
      assertHeaderPlacement(requiredFlows(e1Output, 'e1'), E1_TAB);
    });

    it('keeps sibling groups disjoint and containing their members', () => {
      assertGroupContainment(requiredFlows(e1Output, 'e1'), E1_TAB);
    });

    it('has no backward wires and enforces or diagnoses the visible viewport width', () => {
      const output = requiredFlows(e1Output, 'e1');
      const width = tabBoundingExtent(output, E1_TAB).w;
      expect(flowMetrics(output, E1_TAB).backwardWires).toBe(0);

      /*
       * Width is a contract, not a coordinate snapshot. The hand-arranged e1
       * reference is itself 1640px wide, and this 8-column main chain is
       * topologically bound after min-gap compaction. The plan pins viewport
       * overflow as warning-never-blocks (D-1 / LAYO-6), so the required
       * property is: fit when reachable, otherwise emit the frozen diagnostic
       * loudly with the measured width and imported budget.
       */
      if (width <= SPATIAL_SCAFFOLD_VISIBLE_WIDTH) return;

      const diagnostics = widthOverflowDiagnostics(e1Diagnostics, E1_TAB);
      expect(diagnostics).toHaveLength(1);
      const [diagnostic] = diagnostics;
      expect(diagnostic?.severity).toBe('warning');
      expect(diagnostic?.context?.['width']).toBe(width);
      expect(diagnostic?.context?.['targetWidth']).toBe(SPATIAL_SCAFFOLD_VISIBLE_WIDTH);
    });
  });

  describe('e2 spaghetti fixture', () => {
    it('relayouts with the junction present and changes only geometry fields', () => {
      expect(nodeById(e2Input, E2_JUNCTION).type).toBe('junction');
      assertOnlyGeometryChanged(e2Input, requiredFlows(e2Output, 'e2'));
    });

    it('repositions the junction strictly between its wire neighbors', () => {
      const output = requiredFlows(e2Output, 'e2');
      const metrics = flowMetrics(output, E2_TAB);
      const upstream = positionOf(metrics.positions, E2_SWITCH);
      const junction = positionOf(metrics.positions, E2_JUNCTION);
      const downstream = positionOf(metrics.positions, firstWireTarget(output, E2_JUNCTION, 0));

      expect(junction.x).toBeGreaterThan(Math.min(upstream.x, downstream.x));
      expect(junction.x).toBeLessThan(Math.max(upstream.x, downstream.x));
    });

    it('has no backward wires, no crossings, and keeps switch port 0 above port 1', () => {
      const output = requiredFlows(e2Output, 'e2');
      const metrics = flowMetrics(output, E2_TAB);
      expect(metrics.backwardWires).toBe(0);
      expect(metrics.wireCrossings).toBe(0);
      expect(tabBoundingExtent(output, E2_TAB).w).toBeLessThanOrEqual(
        SPATIAL_SCAFFOLD_VISIBLE_WIDTH,
      );
      assertAffirmativeOnTop(output, E2_TAB, E2_SWITCH);
    });

    it('keeps other tabs byte-identical when relayout is scoped', async () => {
      const scopedInput = e2WithSiblingTab(e2Input);
      const before = otherTabNodeJson(scopedInput, 'e2-sibling-tab');
      const scopedOutput = await layoutFlowsJson(scopedInput, { tabIds: [E2_TAB] });
      expect(otherTabNodeJson(scopedOutput, 'e2-sibling-tab')).toEqual(before);
    });

    it('records the error-lane abstention for the spaghetti fixture', () => {
      // R2's "error-lane-below on both fixtures" reduces to e1-only because
      // the spaghetti fixture has no catch/status/complete error sources.
      expect(laneIds(requiredFlows(e2Output, 'e2'), E2_TAB, 'error')).toEqual([]);
    });
  });
});
