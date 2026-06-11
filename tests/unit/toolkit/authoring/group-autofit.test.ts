/**
 * Group geometry auto-fit (eval campaign 2026-06-10, finding #3): groups
 * authored without explicit geometry must compile to a visible bounding box —
 * Node-RED does not auto-fit dimension-less groups on import.
 *
 * REVIEW NOTE — REND-2 deliberate re-bless (2026-06-10 fix plan, F11):
 * auto-fit member dimensions moved from the old approximate model (12px
 * glyphs, min 80, 240 cap, fixed 30px height, 160px comment default) to the
 * editor-true `nodeDimensionsFor` profile (14px Helvetica Neue regular
 * advances, min 100, no cap, h = max(30, outputs·15), label-derived comment
 * widths, 30×30 hidden-label link pills). Compile output changes ONLY for
 * auto-fit-path groups — explicit geometry is untouched (pinned by
 * e1-byte-identity.test.ts, verified green at HEAD before this change). The
 * 'editor-true member dimensions' block below pins the new boxes exactly;
 * derivations are spelled out inline so a future re-bless is a conscious act.
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

  describe('editor-true member dimensions (REND-2 exact pins)', () => {
    it('fits the canonical two-node group with editor-true widths', () => {
      // Tick (inject, 0 in): labelPx('Tick') = 26 → 26+50 = 76 → w 100, h 30.
      // Sink (debug, 1 in): labelPx('Sink') = 27 → 27+57 = 84 → w 100, h 30.
      // Extents: x 90..590, y 185..215; pads 20/40/20, grid-snapped:
      //   x = floor(70/20)·20 = 60,  y = floor(145/20)·20 = 140
      //   w = ceil((610−60)/20)·20 = 560,  h = ceil((235−140)/20)·20 = 100.
      const { flows } = compile(specWithGroup());
      const g = groupNode(flows);
      expect({ x: g['x'], y: g['y'], w: g['w'], h: g['h'] }).toEqual({
        x: 60,
        y: 140,
        w: 560,
        h: 100,
      });
    });

    it('multi-output members contribute their editor-true height (h = outputs·15)', () => {
      const spec = {
        tabs: [
          {
            id: 'main',
            label: 'Main',
            nodes: [
              {
                key: 'sw',
                type: 'switch',
                label: 'Switch four rules',
                position: { x: 300, y: 200 },
                groupKey: 'g1',
                passthrough: { rules: [{}, {}, {}, {}] },
              },
            ],
            connections: [],
            groups: [{ key: 'g1', name: 'Tall', nodeKeys: ['sw'] }],
            comments: [],
          },
        ],
      } as unknown as AuthoringSpec;
      const { flows } = compile(spec);
      const g = groupNode(flows);
      // 'Switch four rules' (1 in, 4 outs): w 180 (fixture-pinned), h 60.
      // Extents: x 210..390, y 170..230 → box x 180, y 120, w 240, h 140.
      expect({ x: g['x'], y: g['y'], w: g['w'], h: g['h'] }).toEqual({
        x: 180,
        y: 120,
        w: 240,
        h: 140,
      });
    });

    it('label-hidden link members are 30×30 pills, and comments measure by label', () => {
      const spec = {
        tabs: [
          {
            id: 'main',
            label: 'Main',
            nodes: [
              {
                key: 'lnk',
                type: 'link in',
                label: 'ignored when hidden',
                position: { x: 200, y: 200 },
                groupKey: 'g1',
                passthrough: { l: false },
              },
            ],
            connections: [],
            groups: [{ key: 'g1', name: 'Pills', nodeKeys: ['lnk', 'c1'] }],
            comments: [{ key: 'c1', text: 'Short note', position: { x: 200, y: 120 } }],
          },
        ],
      } as unknown as AuthoringSpec;
      const { flows } = compile(spec);
      const g = groupNode(flows);
      // link pill 30×30 at (200,200): x 185..215, y 185..215.
      // 'Short note' comment (0 in): w 120 (fixture-pinned), h 30 → x 140..260, y 105..135.
      // Extents: x 140..260, y 105..215 → box x 120, y 60, w 160, h 180.
      expect({ x: g['x'], y: g['y'], w: g['w'], h: g['h'] }).toEqual({
        x: 120,
        y: 60,
        w: 160,
        h: 180,
      });
    });
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
