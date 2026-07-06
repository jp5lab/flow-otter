import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type {
  AuthoringSpec,
  CommentSpec,
  GroupSpec,
  NodeSpec,
  Position,
} from '../../../../src/toolkit/authoring/types.js';
import { editorGeometryProvider } from '../../../../src/toolkit/render/metrics.js';
import { LANE_GAP, type Lane } from '../../../../src/toolkit/lanes.js';
import {
  dimensionsForJunction,
  dimensionsForNode,
} from '../../../../src/toolkit/layout/apply-positions.js';
import { DEFAULT_GRID, isOnGrid } from '../../../../src/toolkit/layout/grid.js';
import { layoutFlowsWithElk } from '../../../../src/toolkit/layout/elk.js';
import { SPATIAL_SCAFFOLD_VIEWPORT } from '../../../../src/toolkit/layout/spatial-scaffold.js';

interface Rect {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function spec(tab: AuthoringSpec['tabs'][number]): AuthoringSpec {
  return { tabs: [tab] };
}

function node(
  key: string,
  type: string,
  extra: Omit<Partial<NodeSpec>, 'key' | 'type' | 'position'> = {},
): NodeSpec {
  return { key, type, label: key, position: { x: 0, y: 0 }, ...extra };
}

function laneNode(key: string, type: string, lane: Lane, extra: Partial<NodeSpec> = {}): NodeSpec {
  return { ...node(key, type, extra), _authoringLane: lane } as NodeSpec & {
    readonly _authoringLane: Lane;
  };
}

function header(key: string, text: string, groupKey: string): CommentSpec {
  return {
    key,
    text,
    position: { x: 0, y: 0 },
    headerFor: groupKey,
  } as CommentSpec & { readonly headerFor: string };
}

function tab(overrides: Partial<AuthoringSpec['tabs'][number]>): AuthoringSpec['tabs'][number] {
  return {
    id: 'tabA',
    label: 'Tab A',
    nodes: [],
    connections: [],
    groups: [],
    comments: [],
    ...overrides,
  };
}

function firstTab(out: AuthoringSpec) {
  return out.tabs[0]!;
}

function nodeByKey(out: AuthoringSpec, key: string): NodeSpec {
  const found = firstTab(out).nodes.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`missing node ${key}`);
  return found;
}

function groupByKey(out: AuthoringSpec, key: string): GroupSpec {
  const found = firstTab(out).groups.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`missing group ${key}`);
  return found;
}

function commentByKey(out: AuthoringSpec, key: string): CommentSpec {
  const found = firstTab(out).comments.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`missing comment ${key}`);
  return found;
}

function junctionByKey(
  out: AuthoringSpec,
  key: string,
): NonNullable<AuthoringSpec['tabs'][number]['junctions']>[number] {
  const found = firstTab(out).junctions?.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`missing junction ${key}`);
  return found;
}

function centeredRect(position: Position, dims: { readonly w: number; readonly h: number }): Rect {
  return {
    x1: position.x - dims.w / 2,
    y1: position.y - dims.h / 2,
    x2: position.x + dims.w / 2,
    y2: position.y + dims.h / 2,
  };
}

function nodeRect(out: AuthoringSpec, key: string): Rect {
  const found = nodeByKey(out, key);
  return centeredRect(found.position, dimensionsForNode(found));
}

function junctionRect(out: AuthoringSpec, key: string): Rect {
  return centeredRect(junctionByKey(out, key).position, dimensionsForJunction());
}

function commentRect(out: AuthoringSpec, key: string): Rect {
  const found = commentByKey(out, key);
  const dims =
    found.size ??
    editorGeometryProvider.nodeDimensionsFor(found.text, {
      inputs: 0,
      outputs: 0,
    });
  return centeredRect(found.position, dims);
}

function groupRect(out: AuthoringSpec, key: string): Rect {
  const found = groupByKey(out, key);
  if (found.position === undefined || found.size === undefined) {
    throw new Error(`missing group geometry ${key}`);
  }
  return {
    x1: found.position.x,
    y1: found.position.y,
    x2: found.position.x + found.size.w,
    y2: found.position.y + found.size.h,
  };
}

function maxY(rects: readonly Rect[]): number {
  return Math.max(...rects.map((rect) => rect.y2));
}

function contentWidth(out: AuthoringSpec): number {
  const rects = [
    ...firstTab(out).nodes.map((found) => nodeRect(out, found.key)),
    ...(firstTab(out).junctions ?? []).map((found) => junctionRect(out, found.key)),
    ...firstTab(out).groups.map((found) => groupRect(out, found.key)),
    ...firstTab(out).comments.map((found) => commentRect(out, found.key)),
  ];
  return Math.max(...rects.map((rect) => rect.x2)) - Math.min(...rects.map((rect) => rect.x1));
}

function minY(rects: readonly Rect[]): number {
  return Math.min(...rects.map((rect) => rect.y1));
}

function horizontalOverlap(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2
  );
}

function disjoint(a: Rect, b: Rect): boolean {
  return a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1;
}

function groupedFixture(): AuthoringSpec {
  return spec(
    tab({
      nodes: [
        node('parent_in', 'inject', { groupKey: 'parent' }),
        node('child_a', 'function', { groupKey: 'child' }),
        node('child_b', 'debug', { groupKey: 'child' }),
        node('sibling_a', 'inject', { groupKey: 'sibling' }),
        node('sibling_b', 'debug', { groupKey: 'sibling' }),
      ],
      connections: [
        { fromKey: 'parent_in', outputPort: 0, toKey: 'child_a' },
        { fromKey: 'child_a', outputPort: 0, toKey: 'child_b' },
        { fromKey: 'sibling_a', outputPort: 0, toKey: 'sibling_b' },
      ],
      groups: [
        { key: 'parent', name: 'Parent', nodeKeys: ['parent_in'] },
        { key: 'child', name: 'Child', nodeKeys: ['child_a', 'child_b'], parentKey: 'parent' },
        { key: 'sibling', name: 'Sibling', nodeKeys: ['sibling_a', 'sibling_b'] },
      ],
      comments: [header('parent_header', 'Parent header', 'parent')],
    }),
  );
}

function chainFixture(count: number): AuthoringSpec {
  return spec(
    tab({
      nodes: Array.from({ length: count }, (_, index) =>
        node(`n${index.toString().padStart(2, '0')}`, 'function', { label: `N${index}` }),
      ),
      connections: Array.from({ length: count - 1 }, (_, index) => ({
        fromKey: `n${index.toString().padStart(2, '0')}`,
        outputPort: 0,
        toKey: `n${(index + 1).toString().padStart(2, '0')}`,
      })),
      groups: [],
      comments: [],
    }),
  );
}

function groupedChainFixture(count: number): AuthoringSpec {
  const keys = Array.from({ length: count }, (_, index) => `g${index.toString().padStart(2, '0')}`);
  return spec(
    tab({
      nodes: keys.map((key, index) =>
        node(key, 'function', { label: `G${index}`, groupKey: 'wide_group' }),
      ),
      connections: keys.slice(0, -1).map((key, index) => ({
        fromKey: key,
        outputPort: 0,
        toKey: keys[index + 1]!,
      })),
      groups: [{ key: 'wide_group', name: 'Wide Group', nodeKeys: keys }],
      comments: [header('wide_group_header', 'Wide Group header', 'wide_group')],
    }),
  );
}

describe('layoutFlowsWithElk two-level stacking', () => {
  it('stacks the error lane below the main lane with the ratified lane gap', async () => {
    const out = await layoutFlowsWithElk(
      spec(
        tab({
          nodes: [
            node('main_in', 'inject'),
            node('main_fn', 'function'),
            node('main_out', 'debug'),
            laneNode('err_catch', 'catch', 'error'),
            laneNode('err_fn', 'function', 'error'),
          ],
          connections: [
            { fromKey: 'main_in', outputPort: 0, toKey: 'main_fn' },
            { fromKey: 'main_fn', outputPort: 0, toKey: 'main_out' },
            { fromKey: 'main_fn', outputPort: 0, toKey: 'err_catch' },
            { fromKey: 'err_catch', outputPort: 0, toKey: 'err_fn' },
          ],
          groups: [],
          comments: [],
        }),
      ),
    );

    const mainRects = ['main_in', 'main_fn', 'main_out'].map((key) => nodeRect(out, key));
    const errorRects = ['err_catch', 'err_fn'].map((key) => nodeRect(out, key));

    expect(Math.max(...mainRects.map((rect) => (rect.y1 + rect.y2) / 2))).toBeLessThan(
      Math.min(...errorRects.map((rect) => (rect.y1 + rect.y2) / 2)),
    );
    expect(minY(errorRects) - maxY(mainRects)).toBeGreaterThanOrEqual(LANE_GAP);
  });

  it('places six header comments above their groups without origin piles', async () => {
    const groups = Array.from({ length: 6 }, (_, index) => ({
      key: `g${index}`,
      name: `Group ${index}`,
      nodeKeys: [`g${index}_in`, `g${index}_out`],
    }));
    const out = await layoutFlowsWithElk(
      spec(
        tab({
          nodes: groups.flatMap((group) => [
            node(`${group.key}_in`, 'inject', { groupKey: group.key }),
            node(`${group.key}_out`, 'debug', { groupKey: group.key }),
          ]),
          connections: groups.map((group) => ({
            fromKey: `${group.key}_in`,
            outputPort: 0,
            toKey: `${group.key}_out`,
          })),
          groups,
          comments: groups.map((group) =>
            header(`${group.key}_header`, `${group.name} header`, group.key),
          ),
        }),
      ),
    );

    const headerPositions = new Set<string>();
    for (const group of groups) {
      const h = commentByKey(out, `${group.key}_header`);
      const headerBox = commentRect(out, h.key);
      const box = groupRect(out, group.key);
      expect(headerBox.y2).toBeLessThan(box.y1);
      expect(horizontalOverlap(headerBox, box)).toBeGreaterThan(0);
      expect(h.position).not.toEqual({ x: 0, y: 0 });
      headerPositions.add(`${h.position.x},${h.position.y}`);
    }
    expect(headerPositions.size).toBe(groups.length);
  });

  it('keeps headers out of group boxes while stacking later sections below header extents', async () => {
    const out = await layoutFlowsWithElk(
      spec(
        tab({
          nodes: [
            node('plain_in', 'inject'),
            node('plain_out', 'debug'),
            node('group_in', 'inject', { groupKey: 'with_header' }),
            node('group_out', 'debug', { groupKey: 'with_header' }),
          ],
          connections: [
            { fromKey: 'plain_in', outputPort: 0, toKey: 'plain_out' },
            { fromKey: 'group_in', outputPort: 0, toKey: 'group_out' },
          ],
          groups: [
            { key: 'with_header', name: 'With Header', nodeKeys: ['group_in', 'group_out'] },
          ],
          comments: [header('with_header_comment', 'With Header comment', 'with_header')],
        }),
      ),
    );

    const plainBottom = maxY(['plain_in', 'plain_out'].map((key) => nodeRect(out, key)));
    const headerBox = commentRect(out, 'with_header_comment');
    const groupBox = groupRect(out, 'with_header');

    expect(headerBox.y2).toBeLessThan(groupBox.y1);
    expect(headerBox.y1).toBeGreaterThanOrEqual(plainBottom);
  });

  it('writes disjoint sibling group boxes and contains nested groups', async () => {
    const out = await layoutFlowsWithElk(groupedFixture());

    expect(contains(groupRect(out, 'parent'), groupRect(out, 'child'))).toBe(true);
    expect(disjoint(groupRect(out, 'parent'), groupRect(out, 'sibling'))).toBe(true);
  });

  it('stacks disconnected sections in declaration order', async () => {
    const out = await layoutFlowsWithElk(
      spec(
        tab({
          nodes: [
            node('z_first_in', 'inject'),
            node('z_first_out', 'debug'),
            node('a_second_in', 'inject'),
            node('a_second_out', 'debug'),
          ],
          connections: [
            { fromKey: 'z_first_in', outputPort: 0, toKey: 'z_first_out' },
            { fromKey: 'a_second_in', outputPort: 0, toKey: 'a_second_out' },
          ],
          groups: [],
          comments: [],
        }),
      ),
    );

    const firstBottom = maxY(['z_first_in', 'z_first_out'].map((key) => nodeRect(out, key)));
    const secondTop = minY(['a_second_in', 'a_second_out'].map((key) => nodeRect(out, key)));
    expect(firstBottom).toBeLessThanOrEqual(secondTop);
  });

  it('grid-snaps node centers, junction centers, group corners, and header comments', async () => {
    const out = await layoutFlowsWithElk(
      spec(
        tab({
          nodes: [
            node('src', 'inject', { groupKey: 'g1' }),
            node('sink', 'debug', { groupKey: 'g1' }),
          ],
          junctions: [{ key: 'j1', position: { x: 0, y: 0 }, groupKey: 'g1' }],
          connections: [
            { fromKey: 'src', outputPort: 0, toKey: 'j1' },
            { fromKey: 'j1', outputPort: 0, toKey: 'sink' },
          ],
          groups: [{ key: 'g1', name: 'Junction Group', nodeKeys: ['src', 'j1', 'sink'] }],
          comments: [header('g1_header', 'Junction Group header', 'g1')],
        }),
      ),
    );

    for (const found of firstTab(out).nodes) expect(isOnGrid(found.position)).toBe(true);
    for (const found of firstTab(out).junctions ?? []) expect(isOnGrid(found.position)).toBe(true);
    for (const found of firstTab(out).comments) expect(isOnGrid(found.position)).toBe(true);
    for (const found of firstTab(out).groups) {
      expect(found.position).toBeDefined();
      expect(found.size).toBeDefined();
      expect(isOnGrid(found.position!)).toBe(true);
      expect(
        isOnGrid({ x: found.position!.x + found.size!.w, y: found.position!.y + found.size!.h }),
      ).toBe(true);
      expect(found.size!.w).toBeGreaterThanOrEqual(DEFAULT_GRID * 2);
      expect(found.size!.h).toBeGreaterThanOrEqual(DEFAULT_GRID * 2);
    }
    expect(junctionRect(out, 'j1')).toBeDefined();
  });

  it('emits frozen cross-lane and group-spans-lanes diagnostics without throwing', async () => {
    const diagnostics: Array<{ rule: string; severity: string; tabId?: string }> = [];
    await expect(
      layoutFlowsWithElk(
        spec(
          tab({
            nodes: [
              node('main_in', 'inject', { groupKey: 'mixed' }),
              laneNode('error_member', 'catch', 'error', { groupKey: 'mixed' }),
              laneNode('external_error', 'function', 'error'),
            ],
            connections: [
              { fromKey: 'main_in', outputPort: 0, toKey: 'external_error' },
              { fromKey: 'error_member', outputPort: 0, toKey: 'external_error' },
            ],
            groups: [{ key: 'mixed', name: 'Mixed', nodeKeys: ['main_in', 'error_member'] }],
            comments: [],
          }),
        ),
        { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
      ),
    ).resolves.toBeDefined();

    expect(diagnostics).toContainEqual(expect.objectContaining({ rule: 'layout/cross-lane-wire' }));
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ rule: 'layout/group-spans-lanes' }),
    );
  });

  it('compacts a moderately long chain toward the visible viewport width', async () => {
    const uncompacted = await layoutFlowsWithElk(chainFixture(10), { targetWidth: 10_000 });
    const compacted = await layoutFlowsWithElk(chainFixture(10));
    const budget = SPATIAL_SCAFFOLD_VIEWPORT.visible_width;

    expect(contentWidth(uncompacted)).toBeGreaterThan(budget);
    expect(contentWidth(compacted)).toBeLessThanOrEqual(budget);
    expect(contentWidth(compacted)).toBeLessThan(contentWidth(uncompacted));
  });

  it('keeps the frozen width-overflow diagnostic when compaction cannot reach the budget', async () => {
    const diagnostics: Array<{ rule: string; tabId?: string }> = [];
    const out = await layoutFlowsWithElk(chainFixture(20), {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(contentWidth(out)).toBeGreaterThan(SPATIAL_SCAFFOLD_VIEWPORT.visible_width);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ rule: 'layout/width-overflow', tabId: 'tabA' }),
    );
  });

  it('preserves group containment and header placement while compacting width', async () => {
    const out = await layoutFlowsWithElk(groupedChainFixture(10));
    const groupBox = groupRect(out, 'wide_group');
    const headerBox = commentRect(out, 'wide_group_header');

    expect(contentWidth(out)).toBeLessThanOrEqual(SPATIAL_SCAFFOLD_VIEWPORT.visible_width);
    for (const found of firstTab(out).nodes)
      expect(contains(groupBox, nodeRect(out, found.key))).toBe(true);
    expect(headerBox.y2).toBeLessThan(groupBox.y1);
    expect(horizontalOverlap(headerBox, groupBox)).toBeGreaterThan(0);
    expect(isOnGrid(groupByKey(out, 'wide_group').position!)).toBe(true);
    expect(groupByKey(out, 'wide_group').size!.w).toBeGreaterThanOrEqual(DEFAULT_GRID * 2);
    expect(groupByKey(out, 'wide_group').size!.h).toBeGreaterThanOrEqual(DEFAULT_GRID * 2);
  });

  it('is a fixed point after the first two-level layout pass', async () => {
    const first = await layoutFlowsWithElk(groupedFixture());
    const second = await layoutFlowsWithElk(first);
    expect(second).toEqual(first);
  });

  it('F10 grep-guard: new two-level files keep geometry provider ownership and import LANE_GAP', () => {
    const files = ['two-level.ts', 'stack.ts', 'layout-metrics.ts'];
    const sources = files.map((file) =>
      readFileSync(new URL(`../../../../src/toolkit/layout/${file}`, import.meta.url), 'utf8'),
    );
    const sourceWithoutComments = sources.join('\n').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    expect(sourceWithoutComments).not.toMatch(/\bwidth:\s*120\b|\bw:\s*120\b/);
    expect(sourceWithoutComments).not.toMatch(/\bLANE_GAP\s*=\s*120\b/);
    expect(sourceWithoutComments).toContain('LANE_GAP');
  });
});
