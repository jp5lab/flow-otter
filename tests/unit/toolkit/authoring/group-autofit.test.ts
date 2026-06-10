/**
 * Group geometry auto-fit (eval campaign 2026-06-10, finding #3): groups
 * authored without explicit geometry must compile to a visible bounding box —
 * Node-RED does not auto-fit dimension-less groups on import.
 */
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../../../src/shared/canonical-json.js';
import { compile } from '../../../../src/toolkit/authoring/compile.js';
import { decompile } from '../../../../src/toolkit/authoring/decompile.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';

function specWithGroup(groupExtras: Record<string, unknown> = {}): AuthoringSpec {
  return {
    tabs: [
      {
        id: 'main',
        label: 'Main',
        nodes: [
          { key: 'a', type: 'inject', label: 'Tick', position: { x: 140, y: 200 } },
          { key: 'b', type: 'debug', label: 'Sink', position: { x: 540, y: 200 }, groupKey: 'g1' },
        ].map((n) => (n.key === 'a' ? { ...n, groupKey: 'g1' } : n)),
        connections: [],
        groups: [{ key: 'g1', name: 'Pipeline', nodeKeys: ['a', 'b'], ...groupExtras }],
        comments: [],
      },
    ],
  };
}

function groupNode(flows: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  const g = flows.find((n) => n['type'] === 'group');
  expect(g).toBeDefined();
  return g!;
}

describe('group geometry auto-fit', () => {
  it('emits a visible default style so the group renders in the editor', () => {
    const { flows } = compile(specWithGroup());
    const g = groupNode(flows);
    // A group with no style (or style:null) renders an invisible box; the
    // default must carry a real stroke (verified live, eval 2026-06-10).
    const style = g['style'] as Record<string, unknown> | undefined;
    expect(style).toBeDefined();
    expect(style?.['stroke']).toBeTruthy();
    expect(style?.['stroke']).not.toBe('none');
  });

  it('computes grid-snapped numeric geometry when position+size are absent', () => {
    const { flows } = compile(specWithGroup());
    const g = groupNode(flows);
    for (const f of ['x', 'y', 'w', 'h'] as const) {
      expect(typeof g[f], `group.${f} should be a number`).toBe('number');
      expect((g[f] as number) % 20, `group.${f} should be grid-snapped`).toBe(0);
    }
    // Bounding box covers both member centers (140..540 on x, 200 on y).
    const x = g['x'] as number;
    const w = g['w'] as number;
    const y = g['y'] as number;
    const h = g['h'] as number;
    expect(x).toBeLessThan(140);
    expect(x + w).toBeGreaterThan(540);
    expect(y).toBeLessThan(200);
    expect(y + h).toBeGreaterThan(200);
  });

  it('is deterministic and idempotent', () => {
    const a = compile(specWithGroup());
    const b = compile(specWithGroup());
    expect(JSON.stringify(a.flows)).toBe(JSON.stringify(b.flows));
    expect(a.hash).toBe(b.hash);
  });

  it('preserves explicit geometry verbatim (no auto-fit override)', () => {
    const { flows } = compile(
      specWithGroup({ position: { x: 60, y: 60 }, size: { w: 600, h: 220 } }),
    );
    const g = groupNode(flows);
    expect(g['x']).toBe(60);
    expect(g['y']).toBe(60);
    expect(g['w']).toBe(600);
    expect(g['h']).toBe(220);
  });

  it('auto-fitted geometry is stable across decompile → recompile (flows-level round trip)', () => {
    const first = compile(specWithGroup());
    const back = decompile(first.flows);
    const second = compile(back, { prior: first.flows });
    expect(canonicalJson(second.flows)).toBe(canonicalJson(first.flows));
    expect(second.hash).toBe(first.hash);
  });

  it('survives Node-RED null-normalizing the default style (style:null round-trips clean)', () => {
    const first = compile(specWithGroup());
    // Simulate Node-RED storing the group with style:null (its normalization
    // of fields it does not recognize on save).
    const runtimeLike = first.flows.map((n) => (n.type === 'group' ? { ...n, style: null } : n));
    const back = decompile(runtimeLike);
    const second = compile(back, { prior: runtimeLike });
    const g = groupNode(second.flows);
    // The default style is re-applied (not left null) so the group stays visible.
    expect((g['style'] as Record<string, unknown>)?.['stroke']).toBeTruthy();
  });

  it('auto-fits a group whose members include a junction and a comment', () => {
    const spec = {
      tabs: [
        {
          id: 'main',
          label: 'Main',
          nodes: [{ key: 'n1', type: 'inject', label: 'In', position: { x: 200, y: 200 } }],
          junctions: [{ key: 'j1', position: { x: 360, y: 200 } }],
          comments: [{ key: 'c1', text: 'note', position: { x: 200, y: 120 } }],
          connections: [],
          groups: [{ key: 'g1', name: 'Mixed', nodeKeys: ['n1', 'j1', 'c1'] }],
        },
      ],
    } as unknown as AuthoringSpec;
    const { flows } = compile(spec);
    const g = groupNode(flows);
    const x = g['x'] as number;
    const y = g['y'] as number;
    const w = g['w'] as number;
    const h = g['h'] as number;
    for (const f of [x, y, w, h]) expect(typeof f).toBe('number');
    // Box spans the comment (top, y≈120) down past the node/junction row (y≈200).
    expect(y).toBeLessThan(120);
    expect(y + h).toBeGreaterThan(200);
    // Box spans the junction on the right (x≈360).
    expect(x + w).toBeGreaterThan(360);
  });

  it('does NOT auto-fit a parent group that contains only a child group (nested)', () => {
    const spec = {
      tabs: [
        {
          id: 'main',
          label: 'Main',
          nodes: [{ key: 'n1', type: 'inject', label: 'In', position: { x: 200, y: 200 } }],
          connections: [],
          groups: [
            { key: 'parent', name: 'Parent', nodeKeys: [] },
            { key: 'child', name: 'Child', nodeKeys: ['n1'], parentKey: 'parent' },
          ],
          comments: [],
        },
      ],
    } as unknown as AuthoringSpec;
    const { flows } = compile(spec);
    const groups = flows.filter((n) => n.type === 'group') as unknown as Record<string, unknown>[];
    const parent = groups.find((g) => g['name'] === 'Parent')!;
    const child = groups.find((g) => g['name'] === 'Child')!;
    // Parent has no direct positioned members → geometry omitted (legacy).
    expect('x' in parent).toBe(false);
    // Child fits around its node member.
    expect(typeof child['x']).toBe('number');
  });

  it('omits geometry for a group with no positioned members (legacy behavior)', () => {
    const spec = {
      tabs: [
        {
          id: 'main',
          label: 'Main',
          nodes: [{ key: 'a', type: 'inject', label: 'Tick', position: { x: 140, y: 200 } }],
          connections: [],
          groups: [{ key: 'g1', name: 'Empty', nodeKeys: [] }],
          comments: [],
        },
      ],
    } as unknown as AuthoringSpec;
    const { flows } = compile(spec);
    const g = groupNode(flows);
    expect('x' in g).toBe(false);
    expect('w' in g).toBe(false);
  });
});
