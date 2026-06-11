/**
 * REND-1 — editor ground-truth metrics fixture pins (resolves DESIGN.md open
 * question 3).
 *
 * The fixtures under tests/fixtures/editor-metrics/ are ONE-TIME captures of
 * the real Node-RED editor's geometry (model + DOM) for the calibration flow,
 * taken with scripts/editor-metrics-dump.mjs over CDP. CI never re-captures;
 * these tests pin what was captured so that:
 *
 *   1. the empirical invariants REND-2's `nodeDimensionsFor` is built on are
 *      frozen (w ≥ 100, w ≡ 0 mod 20, no 240 cap, h = max(30, 15·outputs),
 *      center anchors, port anchor table), and
 *   2. a future re-capture (Node-RED minor bump) that drifts from 4.1.11
 *      fails LOUDLY with a per-node diff table instead of silently re-blessing
 *      the dimension model.
 *
 * Empirical answer to DESIGN.md open question 3, pinned by the cross-version
 * suite below: Node-RED 5.0.0's node-appearance rework did NOT change any
 * dimension-bearing geometry vs 4.1.11 — model w/h, body rects, port
 * anchors, label transforms/bboxes and label computed style are identical.
 * The ONLY DOM drift is a cosmetic ≤4px decoration halo in the outer <g>
 * getBBox() (invisible selection outline added by the rework), excluded from
 * the dimension comparison and bounded separately.
 *
 * Versioning assumption (recorded in each fixture's `assumptions`): 4.0.x is
 * dimension-identical to 4.1.x — the appearance rework shipped in 5.0; an
 * optional 4.0 capture leg may be added if a container is handy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface Translate {
  x: number;
  y: number;
}

interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MeasuredNode {
  id: string;
  type: string;
  name: string;
  model: {
    x: number;
    y: number;
    w: number;
    h: number;
    inputs: number | null;
    outputs: number | null;
  };
  dom: {
    translate: Translate;
    body: RectBox | null;
    bbox: RectBox | null;
    label: { translate: Translate; bbox: RectBox } | null;
    icon: { width: number; height: number } | null;
    hasButton: boolean;
    inputPorts: Translate[];
    outputPorts: Translate[];
  };
}

interface MeasuredJunction {
  id: string;
  model: { x: number; y: number; w: number | null; h: number | null };
  dom: { translate: Translate; bbox: RectBox | null; background: RectBox | null } | null;
}

interface MeasuredGroup {
  id: string;
  name: string;
  model: { x: number; y: number; w: number; h: number };
  members: string[];
  dom: {
    translate: Translate;
    body: RectBox | null;
    outline: RectBox | null;
    bbox: RectBox | null;
  } | null;
}

interface PortOffsetEntry {
  h: number;
  xFromRight: number;
  ys: number[];
  sourceNodeIds: string[];
}

interface EditorMetricsFixture {
  schema: string;
  nodeRedVersion: string;
  capturedAt: string;
  capture: { tool: string; calibrationFlow: string; [k: string]: unknown };
  assumptions: Record<string, string>;
  labelStyle: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    fontStyle: string;
  };
  nodes: MeasuredNode[];
  comments: MeasuredNode[];
  junctions: MeasuredJunction[];
  groups: MeasuredGroup[];
  outputPortOffsets: Record<string, PortOffsetEntry>;
}

function loadFixture(filename: string): EditorMetricsFixture {
  const path = fileURLToPath(
    new URL(`../../../fixtures/editor-metrics/${filename}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as EditorMetricsFixture;
}

function loadCalibrationFlow(): Array<Record<string, unknown>> {
  const path = fileURLToPath(
    new URL('../../../fixtures/render/calibration-flow.json', import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>;
}

const VERSIONS = [
  { filename: 'nodered-4.1.11.json', version: '4.1.11' },
  { filename: 'nodered-5.0.0.json', version: '5.0.0' },
] as const;

const LADDER_IDS = Array.from({ length: 41 }, (_, n) => `calib-lad-${String(n).padStart(2, '0')}`);

describe.each(VERSIONS)('editor metrics fixture $filename', ({ filename, version }) => {
  const fixture = loadFixture(filename);

  describe('schema sanity', () => {
    it('has the expected envelope', () => {
      expect(fixture.schema).toBe('flow-otter/editor-metrics@1');
      expect(fixture.nodeRedVersion).toBe(version);
      expect(Number.isNaN(Date.parse(fixture.capturedAt))).toBe(false);
      expect(fixture.capture.tool).toBe('scripts/editor-metrics-dump.mjs');
      expect(fixture.capture.calibrationFlow).toBe('tests/fixtures/render/calibration-flow.json');
      expect(fixture.assumptions['nodered-4.0.x']).toMatch(/dimension-identical to 4\.1/);
    });

    it('measures exactly the committed calibration flow (freshness guard)', () => {
      const flow = loadCalibrationFlow();
      const byType = (pred: (t: string) => boolean) =>
        flow
          .filter((o) => pred(o['type'] as string))
          .map((o) => o['id'] as string)
          .sort();
      expect(fixture.nodes.map((n) => n.id).sort()).toEqual(
        byType((t) => !['tab', 'group', 'junction', 'comment'].includes(t)),
      );
      expect(fixture.comments.map((n) => n.id).sort()).toEqual(byType((t) => t === 'comment'));
      expect(fixture.junctions.map((j) => j.id).sort()).toEqual(byType((t) => t === 'junction'));
      expect(fixture.groups.map((g) => g.id).sort()).toEqual(byType((t) => t === 'group'));
    });

    it('every measured node carries full model + DOM geometry', () => {
      for (const n of [...fixture.nodes, ...fixture.comments]) {
        for (const v of [n.model.x, n.model.y, n.model.w, n.model.h]) {
          expect(typeof v, `${n.id} model geometry`).toBe('number');
        }
        expect(n.dom.translate, `${n.id} translate`).not.toBeNull();
        expect(n.dom.body, `${n.id} body rect`).not.toBeNull();
      }
    });
  });

  describe('empirical invariants (REND-2 ground truth)', () => {
    const nodeById = new Map(fixture.nodes.map((n) => [n.id, n]));
    const ladder = LADDER_IDS.map((id) => {
      const n = nodeById.get(id);
      if (!n) throw new Error(`ladder node ${id} missing from fixture`);
      return n;
    });

    it('label ladder: w ≥ 100, w ≡ 0 (mod 20), monotonic in label length', () => {
      for (const n of ladder) {
        expect(n.model.w, `${n.id} width ≥ 100`).toBeGreaterThanOrEqual(100);
        expect(n.model.w % 20, `${n.id} width mod 20`).toBe(0);
      }
      // n = 0 is the default type label ('function') — monotonicity starts at 1.
      for (let i = 2; i < ladder.length; i++) {
        const prev = ladder[i - 1];
        const cur = ladder[i];
        if (prev === undefined || cur === undefined) throw new Error('ladder gap');
        expect(cur.model.w, `width(len ${i}) ≥ width(len ${i - 1})`).toBeGreaterThanOrEqual(
          prev.model.w,
        );
      }
    });

    it('no 240px width cap: the 40-char label measures 340px', () => {
      expect(ladder[40]?.model.w).toBe(340);
    });

    it('every regular node: w ≥ 100 + mod-20, EXCEPT label-hidden link nodes at exactly 30', () => {
      for (const n of fixture.nodes) {
        const labelHiddenLink = n.id === 'calib-link-in-s' || n.id === 'calib-link-out-s';
        if (labelHiddenLink) {
          expect(n.model.w, `${n.id} (link l:false)`).toBe(30);
          expect(n.model.h, `${n.id} (link l:false)`).toBe(30);
        } else {
          expect(n.model.w, `${n.id} width ≥ 100`).toBeGreaterThanOrEqual(100);
          expect(n.model.w % 20, `${n.id} width mod 20`).toBe(0);
        }
      }
    });

    it('node height is max(30, 15·outputs)', () => {
      for (const n of fixture.nodes) {
        const outputs = n.model.outputs ?? 0;
        expect(n.model.h, `${n.id} height`).toBe(Math.max(30, 15 * outputs));
      }
    });

    it('nodes and comments anchor at their CENTER: translate = (x − w/2, y − h/2)', () => {
      for (const n of [...fixture.nodes, ...fixture.comments]) {
        expect(n.dom.translate.x, `${n.id} translate.x`).toBe(n.model.x - n.model.w / 2);
        expect(n.dom.translate.y, `${n.id} translate.y`).toBe(n.model.y - n.model.h / 2);
      }
    });

    it('DOM body rect agrees with the model w/h', () => {
      for (const n of [...fixture.nodes, ...fixture.comments]) {
        expect(n.dom.body?.width, `${n.id} body width`).toBe(n.model.w);
        expect(n.dom.body?.height, `${n.id} body height`).toBe(n.model.h);
      }
    });

    it('output ports: one per output, 5px overhang right, centers symmetric about h/2', () => {
      for (const n of fixture.nodes) {
        expect(n.dom.outputPorts.length, `${n.id} port count`).toBe(n.model.outputs ?? 0);
        const centers = n.dom.outputPorts.map((p) => p.y + 5);
        for (const [i, p] of n.dom.outputPorts.entries()) {
          expect(p.x, `${n.id} port[${i}].x`).toBe(n.model.w - 5);
          const center = centers[i] ?? Number.NaN;
          if (i > 0) {
            expect(center, `${n.id} port centers increasing`).toBeGreaterThan(
              centers[i - 1] ?? Number.NaN,
            );
          }
          const mirror = centers[centers.length - 1 - i] ?? Number.NaN;
          expect(center + mirror, `${n.id} port centers symmetric about h/2`).toBeCloseTo(
            n.model.h,
            6,
          );
        }
      }
    });

    it('input port (when present) sits at (−5, h/2 − 5)', () => {
      for (const n of fixture.nodes) {
        if (n.model.inputs === 1) {
          expect(n.dom.inputPorts, `${n.id} input port`).toEqual([{ x: -5, y: n.model.h / 2 - 5 }]);
        } else {
          expect(n.dom.inputPorts, `${n.id} has no input port`).toEqual([]);
        }
      }
    });

    it('pins the per-port-count output-port anchor table (counts 1–4)', () => {
      const table = Object.fromEntries(
        Object.entries(fixture.outputPortOffsets).map(([count, e]) => [
          count,
          { h: e.h, xFromRight: e.xFromRight, ys: e.ys },
        ]),
      );
      expect(table).toEqual({
        '1': { h: 30, xFromRight: 5, ys: [10] },
        '2': { h: 30, xFromRight: 5, ys: [3.5, 16.5] },
        '3': { h: 45, xFromRight: 5, ys: [4.5, 17.5, 30.5] },
        '4': { h: 60, xFromRight: 5, ys: [5.5, 18.5, 31.5, 44.5] },
      });
    });

    it('inject and debug carry buttons; the 30px icon column is universal', () => {
      for (const n of fixture.nodes) {
        const expectButton = n.type === 'inject' || n.type === 'debug';
        expect(n.dom.hasButton, `${n.id} hasButton`).toBe(expectButton);
        expect(n.dom.icon?.width, `${n.id} icon width`).toBe(30);
      }
    });

    it('label font is 14px (the glyph-width basis REND-2 migrates to)', () => {
      expect(fixture.labelStyle.fontSize).toBe('14px');
      expect(fixture.labelStyle.fontFamily).toContain('Helvetica');
    });

    it('comments: min 120px wide, mod-20, 30px tall', () => {
      expect(fixture.comments.length).toBeGreaterThanOrEqual(2);
      for (const c of fixture.comments) {
        expect(c.model.w, `${c.id} width`).toBeGreaterThanOrEqual(120);
        expect(c.model.w % 20, `${c.id} width mod 20`).toBe(0);
        expect(c.model.h, `${c.id} height`).toBe(30);
      }
    });

    it('junction: 10×10 box centered on its model (x, y)', () => {
      const j = fixture.junctions[0];
      if (j === undefined) throw new Error('no junction in fixture');
      expect(j.dom?.translate).toEqual({ x: j.model.x, y: j.model.y });
      expect(j.dom?.background).toEqual({ x: -5, y: -5, width: 10, height: 10 });
    });

    it('group: DOM geometry equals model bbox (top-left anchored) and encloses members', () => {
      const g = fixture.groups[0];
      if (g === undefined) throw new Error('no group in fixture');
      expect(g.members).toHaveLength(2);
      expect(g.dom?.translate).toEqual({ x: g.model.x, y: g.model.y });
      expect(g.dom?.body?.width).toBe(g.model.w);
      expect(g.dom?.body?.height).toBe(g.model.h);
      for (const memberId of g.members) {
        const m = nodeById.get(memberId);
        if (!m) throw new Error(`group member ${memberId} missing`);
        expect(m.model.x - m.model.w / 2, `${memberId} left edge`).toBeGreaterThanOrEqual(
          g.model.x,
        );
        expect(m.model.x + m.model.w / 2, `${memberId} right edge`).toBeLessThanOrEqual(
          g.model.x + g.model.w,
        );
        expect(m.model.y - m.model.h / 2, `${memberId} top edge`).toBeGreaterThanOrEqual(g.model.y);
        expect(m.model.y + m.model.h / 2, `${memberId} bottom edge`).toBeLessThanOrEqual(
          g.model.y + g.model.h,
        );
      }
    });
  });
});

describe('cross-version drift (4.1.11 vs 5.0.0)', () => {
  const a = loadFixture(VERSIONS[0].filename);
  const b = loadFixture(VERSIONS[1].filename);

  /**
   * The dimension-bearing surface: everything except the outer <g> getBBox()
   * (cosmetic halo, bounded below). If ANY of this drifts between captures,
   * the test fails loudly with a table — that is the tripwire that makes
   * REND-2's "compile pins the 4.1 profile permanently" decision auditable,
   * and the trigger for version-keyed render/lint profiles.
   */
  function comparable(f: EditorMetricsFixture): Record<string, unknown> {
    const stripNode = (n: MeasuredNode) => ({
      type: n.type,
      name: n.name,
      model: n.model,
      translate: n.dom.translate,
      body: n.dom.body,
      label: n.dom.label,
      icon: n.dom.icon,
      hasButton: n.dom.hasButton,
      inputPorts: n.dom.inputPorts,
      outputPorts: n.dom.outputPorts,
    });
    return {
      labelStyle: f.labelStyle,
      outputPortOffsets: f.outputPortOffsets,
      nodes: Object.fromEntries(f.nodes.map((n) => [n.id, stripNode(n)])),
      comments: Object.fromEntries(f.comments.map((n) => [n.id, stripNode(n)])),
      junctions: Object.fromEntries(
        f.junctions.map((j) => [
          j.id,
          { model: j.model, translate: j.dom?.translate, background: j.dom?.background },
        ]),
      ),
      groups: Object.fromEntries(
        f.groups.map((g) => [
          g.id,
          {
            name: g.name,
            model: g.model,
            members: g.members,
            translate: g.dom?.translate,
            body: g.dom?.body,
            outline: g.dom?.outline,
          },
        ]),
      ),
    };
  }

  function diffTable(left: unknown, right: unknown, path: string, rows: string[]): void {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    const bothObjects =
      left !== null &&
      right !== null &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      Array.isArray(left) === Array.isArray(right);
    if (bothObjects) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        diffTable(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          `${path}.${key}`,
          rows,
        );
      }
      return;
    }
    rows.push(
      `${path.padEnd(60)} | 4.1.11: ${JSON.stringify(left)} | 5.0.0: ${JSON.stringify(right)}`,
    );
  }

  it('all dimension-bearing geometry is identical (DESIGN.md open question 3: dims did NOT change in 5.0)', () => {
    const rows: string[] = [];
    diffTable(comparable(a), comparable(b), '$', rows);
    const table =
      rows.length === 0
        ? ''
        : [
            '',
            'EDITOR METRICS DRIFT between nodered-4.1.11.json and nodered-5.0.0.json:',
            `${'path'.padEnd(60)} | 4.1.11 value | 5.0.0 value`,
            '-'.repeat(110),
            ...rows,
            '',
            'If this is a deliberate re-capture: REND-2 keeps compile pinned to the 4.1',
            'profile; version-keyed profiles may apply to render/lint paths only.',
          ].join('\n');
    expect(rows, table).toEqual([]);
  });

  it('the known 5.0 cosmetic outer-bbox halo stays bounded (≤6px outward per edge, never inward)', () => {
    for (const section of ['nodes', 'comments'] as const) {
      const bm = new Map(b[section].map((n) => [n.id, n]));
      for (const an of a[section]) {
        const bn = bm.get(an.id);
        const boxA = an.dom.bbox;
        const boxB = bn?.dom.bbox;
        if (!boxA || !boxB) throw new Error(`missing bbox for ${an.id}`);
        const leftDelta = boxA.x - boxB.x;
        const topDelta = boxA.y - boxB.y;
        const rightDelta = boxB.x + boxB.width - (boxA.x + boxA.width);
        const bottomDelta = boxB.y + boxB.height - (boxA.y + boxA.height);
        for (const [edge, delta] of Object.entries({
          left: leftDelta,
          top: topDelta,
          right: rightDelta,
          bottom: bottomDelta,
        })) {
          expect(delta, `${an.id} bbox ${edge} edge moves outward only`).toBeGreaterThanOrEqual(0);
          expect(delta, `${an.id} bbox ${edge} edge halo ≤ 6px`).toBeLessThanOrEqual(6);
        }
      }
    }
  });
});
