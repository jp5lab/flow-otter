import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../src/shared/flows-json.js';
import {
  deriveFlowsJsonSections,
  deriveTabSpecSections,
} from '../../src/toolkit/layout/sections.js';

import { arbitraryAuthoringSpec } from './arbitraries.js';

const NUM_RUNS = Number(process.env['VITEST_PROP_RUNS'] ?? 1000);

const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
const FLOW_NODE_IDS = ['n0', 'n1', 'n2', 'n3', 'n4'] as const;
const JUNCTION_IDS = ['j0', 'j1'] as const;
const GROUP_IDS = ['g0', 'g1'] as const;
const COMMENT_IDS = ['c0', 'c1'] as const;
const POSSIBLE_MEMBER_IDS = [...FLOW_NODE_IDS, ...JUNCTION_IDS] as const;

function alphaString(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...ALPHA.split('')), { minLength, maxLength })
    .map((chars) => chars.join(''));
}

const arbitraryFlowsJson: fc.Arbitrary<FlowsJson> = fc
  .record({
    tabId: alphaString(3, 8),
    regularCount: fc.integer({ min: 0, max: FLOW_NODE_IDS.length }),
    junctionCount: fc.integer({ min: 0, max: JUNCTION_IDS.length }),
    edges: fc.array(
      fc.tuple(fc.constantFrom(...POSSIBLE_MEMBER_IDS), fc.constantFrom(...POSSIBLE_MEMBER_IDS)),
      {
        minLength: 0,
        maxLength: 8,
      },
    ),
    groupMemberships: fc.array(
      fc.tuple(fc.constantFrom(...GROUP_IDS), fc.constantFrom(...POSSIBLE_MEMBER_IDS)),
      { minLength: 0, maxLength: 6 },
    ),
    groupedCommentIndex: fc
      .option(fc.integer({ min: 0, max: COMMENT_IDS.length - 1 }))
      .map((v) => v ?? -1),
    explicitHeaderFor: fc
      .option(fc.constantFrom('g0-key', 'g1-key', 'missing'))
      .map((v) => v ?? undefined),
  })
  .map((raw): FlowsJson => {
    const nodeIds = FLOW_NODE_IDS.slice(0, raw.regularCount);
    const junctionIds = JUNCTION_IDS.slice(0, raw.junctionCount);
    const memberIds = new Set<string>([...nodeIds, ...junctionIds]);
    const targetsBySource = new Map<string, string[]>();

    for (const [source, target] of raw.edges) {
      if (!memberIds.has(source) || !memberIds.has(target) || source === target) continue;
      const targets = targetsBySource.get(source);
      if (targets === undefined) targetsBySource.set(source, [target]);
      else targets.push(target);
    }

    const groupMembers = new Map<string, string[]>();
    for (const [groupId, memberId] of raw.groupMemberships) {
      if (!memberIds.has(memberId)) continue;
      const members = groupMembers.get(groupId);
      if (members === undefined) groupMembers.set(groupId, [memberId]);
      else members.push(memberId);
    }

    return [
      { id: raw.tabId, type: 'tab', label: 'T' },
      ...GROUP_IDS.map((groupId, i) => ({
        id: groupId,
        type: 'group',
        z: raw.tabId,
        x: i * 200,
        y: 100,
        w: 120,
        h: 80,
        name: `G${i}`,
        nodes: groupMembers.get(groupId) ?? [],
        _authoringKey: `${groupId}-key`,
      })),
      ...nodeIds.map((id, i) => ({
        id,
        type: 'function',
        z: raw.tabId,
        x: i * 100,
        y: 200,
        wires: [targetsBySource.get(id) ?? []],
        ...(i === 0 ? { broker: 'cfg0' } : {}),
      })),
      ...junctionIds.map((id, i) => ({
        id,
        type: 'junction',
        z: raw.tabId,
        x: i * 100,
        y: 300,
        wires: [targetsBySource.get(id) ?? []],
      })),
      {
        id: 'cfg0',
        type: 'mqtt-broker',
        z: raw.tabId,
        x: 0,
        y: 0,
        wires: [[]],
      },
      ...COMMENT_IDS.map((id, i) => ({
        id,
        type: 'comment',
        z: raw.tabId,
        x: i * 200 + 40,
        y: 60,
        name: `G${i}`,
        ...(raw.groupedCommentIndex === i ? { g: GROUP_IDS[i] } : {}),
        ...(raw.explicitHeaderFor !== undefined
          ? { _authoringHeaderFor: raw.explicitHeaderFor }
          : {}),
      })),
    ] as FlowsJson;
  });

describe('section derivation properties', () => {
  it('deriveTabSpecSections is total over arbitrary tab specs', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        for (const tab of spec.tabs) expect(() => deriveTabSpecSections(tab)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('deriveTabSpecSections is deterministic for the same tab spec', () => {
    fc.assert(
      fc.property(arbitraryAuthoringSpec, (spec) => {
        const first = spec.tabs.map((tab) => deriveTabSpecSections(tab));
        const second = spec.tabs.map((tab) => deriveTabSpecSections(tab));
        expect(second).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('deriveFlowsJsonSections is total over arbitrary flows arrays', () => {
    fc.assert(
      fc.property(arbitraryFlowsJson, (flows) => {
        expect(() => deriveFlowsJsonSections(flows)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('deriveFlowsJsonSections is deterministic for the same flows array', () => {
    fc.assert(
      fc.property(arbitraryFlowsJson, (flows) => {
        expect(deriveFlowsJsonSections(flows)).toEqual(deriveFlowsJsonSections(flows));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
