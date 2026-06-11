/**
 * REND-7 — single ±2px renderer-fidelity comparator (per-corner + per-port,
 * the stricter basis). This library is consumed by BOTH
 * `npm run fidelity:editor` (scripts/editor-fidelity-check.mjs) and EVAL-2's
 * `eval:s5` fidelity leg — its semantics are frozen here. Synthetic-delta
 * pass/fail/report coverage, editor-dump normalization, junction
 * coordinate-pairing (junction <g> has no id in the editor DOM — REND-1),
 * the fixture-freshness guard, and the R3 acceptance rehearsal on the
 * canonical e1 audit fixture.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  captureEditorGeometry,
  checkFixtureFreshness,
  compareGeometry,
  cornersOf,
  EDITOR_DERIVED_KINDS,
  editorComparableEntries,
  FIDELITY_TOLERANCE_PX,
  formatFidelityReport,
  normalizeEditorDump,
  pageEditorReady,
  pageGeometryDump,
  pairEntries,
  type FidelityEntry,
  type RawEditorDump,
} from '../../../../scripts/eval/fidelity.mjs';
import { renderGeometry } from '../../../../src/toolkit/render/svg.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';

const E1_PATH = fileURLToPath(
  new URL('../../../fixtures/audit-2026-06-10/e1-flows.json', import.meta.url),
);
const E1_TAB = 'f6f2187d.f17ca8';

function e1Flows(): FlowsJson {
  const doc = JSON.parse(readFileSync(E1_PATH, 'utf8')) as { flows: FlowsJson };
  return doc.flows;
}

function node(over: Partial<FidelityEntry> = {}): FidelityEntry {
  return {
    id: 'n1',
    kind: 'node',
    x: 940,
    y: 260,
    w: 160,
    h: 30,
    ports: [
      { kind: 'input', index: 0, x: 860, y: 260 },
      { kind: 'output', index: 0, x: 1020, y: 253.5 },
      { kind: 'output', index: 1, x: 1020, y: 266.5 },
    ],
    ...over,
  };
}

function shift(e: FidelityEntry, dx: number, dy: number): FidelityEntry {
  return {
    ...e,
    x: e.x + dx,
    y: e.y + dy,
    ports: e.ports.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
}

describe('cornersOf', () => {
  it('derives the four corners from a center-convention entry', () => {
    expect(cornersOf({ x: 940, y: 260, w: 160, h: 30 })).toEqual([
      { corner: 'top-left', x: 860, y: 245 },
      { corner: 'top-right', x: 1020, y: 245 },
      { corner: 'bottom-left', x: 860, y: 275 },
      { corner: 'bottom-right', x: 1020, y: 275 },
    ]);
  });
});

describe('compareGeometry — synthetic deltas', () => {
  it('passes on identical geometry and counts corners + ports', () => {
    const result = compareGeometry([node()], [node()]);
    expect(result.pass).toBe(true);
    expect(result.tolerance_px).toBe(FIDELITY_TOLERANCE_PX);
    expect(result.entries_compared).toBe(1);
    expect(result.corners_checked).toBe(4);
    expect(result.ports_checked).toBe(3);
    expect(result.mismatches).toEqual([]);
  });

  it('passes a whole-entry shift of exactly ±2px (tolerance is inclusive)', () => {
    expect(compareGeometry([node()], [shift(node(), 2, -2)]).pass).toBe(true);
  });

  it('fails a 2.5px shift, naming every corner and port with its delta', () => {
    const result = compareGeometry([node()], [shift(node(), 2.5, 0)]);
    expect(result.pass).toBe(false);
    const checks = result.mismatches.map((m) => m.check);
    expect(checks).toContain('corner:top-left');
    expect(checks).toContain('corner:bottom-right');
    expect(checks).toContain('port:output[1]');
    for (const m of result.mismatches) {
      expect(m.id).toBe('n1');
      expect(m.dx).toBeCloseTo(2.5);
      expect(m.dy).toBeCloseTo(0);
    }
  });

  it('per-corner is the stricter basis: a 5px-wider box with the SAME center fails', () => {
    // Center comparison alone would pass this — the per-corner amendment
    // exists precisely so width drift halved across both edges is caught.
    const wider = { ...node(), w: 165 };
    const result = compareGeometry([node()], [wider]);
    expect(result.pass).toBe(false);
    const corners = result.mismatches.filter((m) => m.check.startsWith('corner:'));
    expect(corners.map((m) => m.check).sort()).toEqual([
      'corner:bottom-left',
      'corner:bottom-right',
      'corner:top-left',
      'corner:top-right',
    ]);
    expect(Math.abs(corners[0]!.dx!)).toBeCloseTo(2.5);
  });

  it('fails a single port drifted 3px, naming exactly that port', () => {
    const drifted = node();
    drifted.ports = drifted.ports.map((p) =>
      p.kind === 'output' && p.index === 0 ? { ...p, y: p.y + 3 } : p,
    );
    const result = compareGeometry([node()], [drifted]);
    expect(result.pass).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      id: 'n1',
      check: 'port:output[0]',
      dy: 3,
    });
  });

  it('reports port-count drift per port kind', () => {
    const fewer = node();
    fewer.ports = fewer.ports.filter((p) => p.kind !== 'output' || p.index === 0);
    const result = compareGeometry([node()], [fewer]);
    expect(result.pass).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({
      check: 'port-count:output',
      expected: { count: 2 },
      actual: { count: 1 },
      dx: null,
      dy: null,
    });
  });

  it('reports missing (expected-only) and unexpected (editor-only) entries', () => {
    const other = node({ id: 'n2', x: 200, y: 200 });
    const result = compareGeometry([node()], [other]);
    expect(result.pass).toBe(false);
    expect(result.missing).toEqual([{ id: 'n1', kind: 'node', x: 940, y: 260 }]);
    expect(result.unexpected).toEqual([{ id: 'n2', kind: 'node', x: 200, y: 200 }]);
  });

  it('honors a custom tolerancePx', () => {
    expect(compareGeometry([node()], [shift(node(), 3, 0)], { tolerancePx: 3 }).pass).toBe(true);
  });

  it('applies offset to the actual side (renderer translate mapping)', () => {
    // Renderer space = editor space + translate: an actual capture offset by
    // (-40, -20) compares clean with offset {x: 40, y: 20}.
    const result = compareGeometry([node()], [shift(node(), -40, -20)], {
      offset: { x: 40, y: 20 },
    });
    expect(result.pass).toBe(true);
  });
});

describe('junction pairing — by coordinates, never by id (REND-1: no DOM id)', () => {
  const junction = (id: string, x: number, y: number): FidelityEntry => ({
    id,
    kind: 'junction',
    x,
    y,
    w: 10,
    h: 10,
    ports: [
      { kind: 'input', index: 0, x, y },
      { kind: 'output', index: 0, x, y },
    ],
  });

  it('pairs junctions with mismatched ids by nearest center', () => {
    const { pairs, missing, unexpected } = pairEntries(
      [junction('exp-a', 100, 100), junction('exp-b', 300, 100)],
      [junction('dom-1', 301, 101), junction('dom-2', 100, 100)],
    );
    expect(missing).toEqual([]);
    expect(unexpected).toEqual([]);
    const matched = pairs.map((p) => [p.expected.id, p.actual.id]);
    expect(matched).toContainEqual(['exp-a', 'dom-2']);
    expect(matched).toContainEqual(['exp-b', 'dom-1']);
  });

  it('a slightly-drifted junction still pairs and fails on corners, not as missing', () => {
    const result = compareGeometry([junction('exp', 100, 100)], [junction('dom', 105, 100)]);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual([]);
    expect(result.pass).toBe(false);
    expect(result.mismatches.some((m) => m.check.startsWith('corner:'))).toBe(true);
  });

  it('a junction beyond the pairing radius is missing + unexpected', () => {
    const result = compareGeometry([junction('exp', 100, 100)], [junction('dom', 200, 100)]);
    expect(result.missing).toEqual([{ id: 'exp', kind: 'junction', x: 100, y: 100 }]);
    expect(result.unexpected).toEqual([{ id: 'dom', kind: 'junction', x: 200, y: 100 }]);
  });

  it('non-junction kinds pair strictly by id (never by coordinates)', () => {
    const result = compareGeometry([node({ id: 'a' })], [node({ id: 'b' })]);
    expect(result.missing).toHaveLength(1);
    expect(result.unexpected).toHaveLength(1);
  });
});

describe('formatFidelityReport', () => {
  it('summarizes a pass with the checked counts and tolerance', () => {
    const report = formatFidelityReport(compareGeometry([node()], [node()]));
    expect(report).toContain('fidelity: PASS');
    expect(report).toContain('1 entries, 4 corners, 3 ports checked');
    expect(report).toContain('±2px');
  });

  it('lists mismatch, missing and unexpected lines on failure', () => {
    const other = node({ id: 'n2', x: 200, y: 200 });
    const result = compareGeometry([node(), other], [shift(node(), 3, 0)]);
    const report = formatFidelityReport(result);
    expect(report).toContain('fidelity: FAIL');
    expect(report).toMatch(/MISMATCH node n1 corner:top-left/);
    expect(report).toMatch(/MISSING node n2/);
  });
});

describe('normalizeEditorDump', () => {
  const raw: RawEditorDump = {
    version: '4.1.11',
    activeWorkspace: 'tab1',
    nodes: [
      {
        id: 'sw',
        type: 'switch',
        x: 940,
        y: 260,
        w: 160,
        h: 30,
        // DOM port translates are port-BOX top-left, relative to the node's
        // top-left-translated <g>: centers are translate + 5.
        inputPorts: [{ x: -5, y: 10 }],
        outputPorts: [
          { x: 155, y: 3.5 },
          { x: 155, y: 16.5 },
        ],
      },
      {
        id: 'cm',
        type: 'comment',
        x: 300,
        y: 40,
        w: 120,
        h: 30,
        inputPorts: [],
        outputPorts: [],
      },
    ],
    groups: [{ id: 'g1', x: 860, y: 120, w: 420, h: 180 }],
    junctions: [{ id: 'j1', x: 520, y: 240, w: null, h: null }],
  };

  it('produces renderGeometry-shaped entries (centers, port-box centers)', () => {
    const entries = normalizeEditorDump(raw);
    expect(entries).toEqual([
      {
        id: 'sw',
        kind: 'node',
        x: 940,
        y: 260,
        w: 160,
        h: 30,
        ports: [
          { kind: 'input', index: 0, x: 860, y: 260 },
          { kind: 'output', index: 0, x: 1020, y: 253.5 },
          { kind: 'output', index: 1, x: 1020, y: 266.5 },
        ],
      },
      { id: 'cm', kind: 'comment', x: 300, y: 40, w: 120, h: 30, ports: [] },
      { id: 'g1', kind: 'group', x: 1070, y: 210, w: 420, h: 180, ports: [] },
      {
        id: 'j1',
        kind: 'junction',
        x: 520,
        y: 240,
        w: 10,
        h: 10,
        ports: [
          { kind: 'input', index: 0, x: 520, y: 240 },
          { kind: 'output', index: 0, x: 520, y: 240 },
        ],
      },
    ]);
  });

  it('normalized e1-shaped dump round-trips clean through the comparator', () => {
    const entries = normalizeEditorDump(raw);
    const result = compareGeometry(entries, entries);
    expect(result.pass).toBe(true);
    expect(result.entries_compared).toBe(4);
  });
});

describe('in-page functions stay CDP-serializable', () => {
  it('reference no module scope, imports, or Node globals', () => {
    for (const fn of [pageEditorReady, pageGeometryDump]) {
      const src = fn.toString();
      expect(src).not.toMatch(/\bimport\b|\brequire\(/);
      expect(src).not.toMatch(/PORT_BOX_HALF_PX|process\.|Buffer\b/);
    }
  });

  it('captureEditorGeometry is the session-level wrapper (smoke shape check)', () => {
    expect(typeof captureEditorGeometry).toBe('function');
  });
});

describe('checkFixtureFreshness — guard rules', () => {
  const fixtures = [
    { nodeRedVersion: '4.1.11', capturedAt: '2026-06-11T04:35:20.011Z' },
    { nodeRedVersion: '5.0.0', capturedAt: '2026-06-11T04:36:07.487Z' },
  ];

  it('exact version match is fresh', () => {
    const r = checkFixtureFreshness({ liveVersion: '4.1.11', fixtures });
    expect(r).toMatchObject({ fresh: true, rule: 'exact' });
    expect(r.matched?.nodeRedVersion).toBe('4.1.11');
  });

  it('patch drift within the same minor is fresh (flagged as patch-drift)', () => {
    const r = checkFixtureFreshness({ liveVersion: '4.1.12', fixtures });
    expect(r).toMatchObject({ fresh: true, rule: 'patch-drift' });
    expect(r.matched?.nodeRedVersion).toBe('4.1.11');
  });

  it('4.0.x rides the recorded 4.0-equals-4.1 assumption', () => {
    const r = checkFixtureFreshness({ liveVersion: '4.0.9', fixtures });
    expect(r).toMatchObject({ fresh: true, rule: 'nodered-4.0-assumption' });
    expect(r.matched?.nodeRedVersion).toBe('4.1.11');
  });

  it('an uncaptured minor is stale and names the re-capture recipe', () => {
    const r = checkFixtureFreshness({ liveVersion: '5.1.0', fixtures });
    expect(r.fresh).toBe(false);
    expect(r.rule).toBe('stale');
    expect(r.reason).toContain('editor-metrics-dump.mjs');
  });

  it('no fixtures at all fails the guard', () => {
    expect(checkFixtureFreshness({ liveVersion: '4.1.11', fixtures: [] })).toMatchObject({
      fresh: false,
      rule: 'no-fixtures',
    });
  });

  it('a matched fixture with an unparseable or future capturedAt is invalid', () => {
    expect(
      checkFixtureFreshness({
        liveVersion: '4.1.11',
        fixtures: [{ nodeRedVersion: '4.1.11', capturedAt: 'not-a-date' }],
      }),
    ).toMatchObject({ fresh: false, rule: 'invalid-fixture' });
    expect(
      checkFixtureFreshness({
        liveVersion: '4.1.11',
        fixtures: [{ nodeRedVersion: '4.1.11', capturedAt: '2999-01-01T00:00:00.000Z' }],
      }),
    ).toMatchObject({ fresh: false, rule: 'invalid-fixture' });
  });

  it('a non-semver live version fails the guard', () => {
    expect(checkFixtureFreshness({ liveVersion: 'beta', fixtures })).toMatchObject({
      fresh: false,
      rule: 'invalid-live-version',
    });
  });

  it('the COMMITTED fixtures are fresh for the pinned 4.1.11 target', () => {
    const committed = ['nodered-4.1.11.json', 'nodered-5.0.0.json'].map(
      (f) =>
        JSON.parse(
          readFileSync(
            fileURLToPath(new URL(`../../../fixtures/editor-metrics/${f}`, import.meta.url)),
            'utf8',
          ),
        ) as { nodeRedVersion: string; capturedAt: string },
    );
    expect(checkFixtureFreshness({ liveVersion: '4.1.11', fixtures: committed })).toMatchObject({
      fresh: true,
      rule: 'exact',
    });
  });
});

describe('editorComparableEntries — live-comparison basis', () => {
  it('drops exactly the editor-derived kinds (groups) and keeps everything else', () => {
    expect(EDITOR_DERIVED_KINDS).toEqual(['group']);
    const entries = renderGeometry(e1Flows(), E1_TAB);
    const basis = editorComparableEntries(entries);
    expect(entries).toHaveLength(26);
    expect(basis).toHaveLength(20); // 14 nodes + 6 comments
    expect(basis.some((e) => e.kind === 'group')).toBe(false);
    expect(basis.filter((e) => e.kind === 'comment')).toHaveLength(6);
  });
});

describe('R3 acceptance rehearsal — canonical e1 fixture', () => {
  it('renderGeometry vs an identical capture passes with full e1 coverage', () => {
    const expected = renderGeometry(e1Flows(), E1_TAB);
    const actual = structuredClone(expected);
    const result = compareGeometry(expected, actual);
    expect(result.pass).toBe(true);
    expect(result.entries_compared).toBe(26); // 14 nodes + 6 groups + 6 comments
    expect(result.corners_checked).toBe(104);
    expect(result.ports_checked).toBe(22);
  });

  it('a 3px drift on the e1 switch fails and the report names it', () => {
    const expected = renderGeometry(e1Flows(), E1_TAB);
    const actual = structuredClone(expected).map((e) =>
      e.id === '3865da1cf3821d01' ? shift(e, 3, 0) : e,
    );
    const result = compareGeometry(expected, actual);
    expect(result.pass).toBe(false);
    expect(result.mismatches.every((m) => m.id === '3865da1cf3821d01')).toBe(true);
    expect(formatFidelityReport(result)).toContain('3865da1cf3821d01');
  });
});
