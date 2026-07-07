import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { FlowsJson, FlowsJsonNode } from '../../../../src/shared/flows-json.js';
import type { TabSpec } from '../../../../src/toolkit/authoring/types.js';
import {
  deriveFlowsJsonSections,
  deriveTabSpecSections,
} from '../../../../src/toolkit/layout/sections.js';

const TAB = { id: 'tab1', type: 'tab', label: 'Main' } as const;

function flow(...nodes: FlowsJsonNode[]): FlowsJson {
  return [TAB, ...nodes] as FlowsJson;
}

function regular(
  id: string,
  type: string,
  wires: readonly (readonly string[])[] = [],
  extra: Record<string, unknown> = {},
): FlowsJsonNode {
  return { id, type, z: TAB.id, x: 100, y: 100, wires: wires.map((row) => [...row]), ...extra };
}

function tabSpec(overrides: Partial<TabSpec>): TabSpec {
  return {
    id: 'tab1',
    label: 'Main',
    nodes: [],
    connections: [],
    groups: [],
    comments: [],
    ...overrides,
  };
}

describe('deriveTabSpecSections', () => {
  it('partitions disconnected pipelines into sections in declaration order', () => {
    const sections = deriveTabSpecSections(
      tabSpec({
        nodes: [
          { key: 'a', type: 'inject', position: { x: 0, y: 0 } },
          { key: 'b', type: 'debug', position: { x: 100, y: 0 } },
          { key: 'c', type: 'inject', position: { x: 0, y: 100 } },
          { key: 'd', type: 'debug', position: { x: 100, y: 100 } },
        ],
        connections: [
          { fromKey: 'a', outputPort: 0, toKey: 'b' },
          { fromKey: 'c', outputPort: 0, toKey: 'd' },
        ],
      }),
    );

    expect(sections.sections.map((s) => [s.id, s.memberIds])).toEqual([
      ['a', ['a', 'b']],
      ['c', ['c', 'd']],
    ]);
    expect(sections.sectionIdByMemberId).toEqual(
      new Map([
        ['a', 'a'],
        ['b', 'a'],
        ['c', 'c'],
        ['d', 'c'],
      ]),
    );
  });

  it('keeps empty and spanning groups from merging disconnected components', () => {
    const sections = deriveTabSpecSections(
      tabSpec({
        nodes: [
          { key: 'a', type: 'inject', position: { x: 0, y: 0 } },
          { key: 'b', type: 'debug', position: { x: 100, y: 0 } },
          { key: 'c', type: 'inject', position: { x: 0, y: 100 } },
          { key: 'd', type: 'debug', position: { x: 100, y: 100 } },
        ],
        connections: [
          { fromKey: 'a', outputPort: 0, toKey: 'b' },
          { fromKey: 'c', outputPort: 0, toKey: 'd' },
        ],
        groups: [
          { key: 'g-spans', name: 'Span', nodeKeys: ['b', 'c'] },
          { key: 'g-empty', name: 'Empty', nodeKeys: [] },
        ],
      }),
    );

    expect(sections.sections.map((s) => [s.id, s.memberIds])).toEqual([
      ['a', ['a', 'b']],
      ['c', ['c', 'd']],
    ]);
    expect(sections.sectionIdsByGroupId.get('g-spans')).toEqual(['a', 'c']);
    expect(sections.sectionIdsByGroupId.get('g-empty')).toEqual([]);
  });

  it('treats junctions as section members and connects components through their wires', () => {
    const sections = deriveTabSpecSections(
      tabSpec({
        nodes: [
          { key: 'src', type: 'inject', position: { x: 0, y: 0 } },
          { key: 'dst', type: 'debug', position: { x: 200, y: 0 } },
        ],
        junctions: [{ key: 'j1', position: { x: 100, y: 0 } }],
        connections: [
          { fromKey: 'src', outputPort: 0, toKey: 'j1' },
          { fromKey: 'j1', outputPort: 0, toKey: 'dst' },
        ],
      }),
    );

    expect(sections.sections).toHaveLength(1);
    expect(sections.sections[0]?.memberIds).toEqual(['src', 'dst', 'j1']);
    expect(sections.sectionIdByMemberId).toEqual(
      new Map([
        ['src', 'src'],
        ['dst', 'src'],
        ['j1', 'src'],
      ]),
    );
  });

  it('lets explicit spec headerFor win over heuristic and falls back when unresolved', () => {
    const sections = deriveTabSpecSections(
      tabSpec({
        groups: [
          {
            key: 'explicit',
            name: 'EXPLICIT',
            nodeKeys: [],
            position: { x: 0, y: 100 },
            size: { w: 100, h: 80 },
          },
          {
            key: 'heuristic',
            name: 'HEUR',
            nodeKeys: [],
            position: { x: 200, y: 100 },
            size: { w: 100, h: 80 },
          },
        ],
        comments: [
          {
            key: 'c-explicit',
            text: 'HEUR via explicit',
            position: { x: 250, y: 60 },
            headerFor: 'explicit',
          },
          {
            key: 'c-fallback',
            text: 'HEUR via fallback',
            position: { x: 250, y: 60 },
            headerFor: 'missing',
          },
        ],
      }),
    );

    expect(sections.headerGroupIdByCommentId.get('c-explicit')).toBe('explicit');
    expect(sections.headerGroupIdByCommentId.get('c-fallback')).toBe('heuristic');
  });
});

describe('deriveFlowsJsonSections', () => {
  it("associates the e1 fixture's DECIDE header and all same-named headers", () => {
    const fixture = JSON.parse(
      readFileSync('tests/fixtures/audit-2026-06-10/e1-flows.json', 'utf8'),
    ) as { flows: FlowsJson };
    const sections = deriveFlowsJsonSections(fixture.flows).get('f6f2187d.f17ca8');
    const expectedHeaders = new Map([
      ['dc777584e131bffc', 'dd3f4f0cc227dbe2'],
      ['10deaa2c1dbb5965', 'd1a840e74fe544ee'],
      ['3a0e88a38a9a3048', '0aac79d8f4c4ccf4'],
      ['c9f8a0013d7fc511', 'd46e3e78bd49e01f'],
      ['02372a46b3d91041', '442a71a70ec0a264'],
      ['d2d88624272bb2d6', 'd14a02e5f693f249'],
    ]);

    expect(sections?.headerGroupIdByCommentId.get('3a0e88a38a9a3048')).toBe('0aac79d8f4c4ccf4');
    for (const [commentId, groupId] of expectedHeaders) {
      expect(sections?.headerGroupIdByCommentId.get(commentId)).toBe(groupId);
    }
  });

  it('lets explicit flows _authoringHeaderFor win over heuristic and falls back when unresolved', () => {
    const sections = deriveFlowsJsonSections(
      flow(
        {
          id: 'g-explicit',
          type: 'group',
          z: TAB.id,
          x: 0,
          y: 100,
          w: 100,
          h: 80,
          name: 'EXPLICIT',
          nodes: [],
          _authoringKey: 'explicit-key',
        },
        {
          id: 'g-heuristic',
          type: 'group',
          z: TAB.id,
          x: 200,
          y: 100,
          w: 100,
          h: 80,
          name: 'HEUR',
          nodes: [],
        },
        {
          id: 'c-explicit',
          type: 'comment',
          z: TAB.id,
          x: 250,
          y: 60,
          name: 'HEUR via explicit',
          _authoringHeaderFor: 'explicit-key',
        },
        {
          id: 'c-fallback',
          type: 'comment',
          z: TAB.id,
          x: 250,
          y: 60,
          name: 'HEUR via fallback',
          _authoringHeaderFor: 'missing',
        },
      ),
    ).get(TAB.id);

    expect(sections?.headerGroupIdByCommentId.get('c-explicit')).toBe('g-explicit');
    expect(sections?.headerGroupIdByCommentId.get('c-fallback')).toBe('g-heuristic');
  });

  it('never treats a comment with group membership as a header', () => {
    const sections = deriveFlowsJsonSections(
      flow(
        {
          id: 'g1',
          type: 'group',
          z: TAB.id,
          x: 0,
          y: 100,
          w: 100,
          h: 80,
          name: 'GROUP',
          nodes: [],
        },
        {
          id: 'c1',
          type: 'comment',
          z: TAB.id,
          x: 50,
          y: 60,
          name: 'GROUP',
          g: 'g1',
          _authoringHeaderFor: 'g1',
        },
      ),
    ).get(TAB.id);

    expect(sections?.headerGroupIdByCommentId.has('c1')).toBe(false);
    expect(sections?.headerCommentIdsByGroupId.get('g1')).toBeUndefined();
  });

  it('excludes config-shaped nodes and comments from section membership', () => {
    const sections = deriveFlowsJsonSections(
      flow(
        {
          id: 'broker',
          type: 'mqtt-broker',
          z: TAB.id,
          x: 20,
          y: 20,
          wires: [[]],
        },
        {
          id: 'note',
          type: 'comment',
          z: TAB.id,
          x: 50,
          y: 40,
          name: 'NOTE',
        },
        regular('mqtt-in', 'mqtt in', [], { broker: 'broker' }),
      ),
    ).get(TAB.id);

    expect(sections?.sections.map((s) => s.memberIds)).toEqual([['mqtt-in']]);
    expect(sections?.sectionIdByMemberId.has('broker')).toBe(false);
    expect(sections?.sectionIdByMemberId.has('note')).toBe(false);
  });
});
