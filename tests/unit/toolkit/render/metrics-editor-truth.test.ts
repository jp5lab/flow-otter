/**
 * REND-2 — editor-true dimension model vs the REND-1 ground-truth fixture.
 *
 * `nodeDimensionsFor` (and the GeometryProvider built on it) must reproduce
 * the Node-RED 4.1.11 editor's node geometry EXACTLY — the fixture under
 * tests/fixtures/editor-metrics/ is the one-time captured truth, and every
 * node in it (ladder, special types, label-hidden links, comments) is
 * asserted here table-driven. Exact equality subsumes the fix-plan's ±2px
 * acceptance bar (widths are mod-20, so any model error is ≥20px).
 *
 * Port anchors are pinned against the fixture's per-port-count TABLE (the
 * REND-1 instruction: pin the table, not a formula) plus every node's
 * captured DOM port boxes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getInputPortCount, isNodeLabelHidden } from '../../../../src/toolkit/authoring/types.js';
import {
  EDITOR_GEOMETRY_PROFILE,
  editorGeometryProvider,
  inputPortAnchor,
  labelWidthPx,
  nodeDimensionsFor,
  nodeWidthFor,
  outputPortAnchors,
} from '../../../../src/toolkit/render/metrics.js';

interface MeasuredEntity {
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
    inputPorts: Array<{ x: number; y: number }>;
    outputPorts: Array<{ x: number; y: number }>;
  };
}

interface MetricsFixture {
  nodeRedVersion: string;
  nodes: MeasuredEntity[];
  comments: MeasuredEntity[];
  outputPortOffsets: Record<string, { h: number; xFromRight: number; ys: number[] }>;
}

function loadFixture(): MetricsFixture {
  const path = fileURLToPath(
    new URL('../../../fixtures/editor-metrics/nodered-4.1.11.json', import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as MetricsFixture;
}

function loadCalibrationFlow(): Map<string, Record<string, unknown>> {
  const path = fileURLToPath(
    new URL('../../../fixtures/render/calibration-flow.json', import.meta.url),
  );
  const flow = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>;
  return new Map(flow.map((n) => [n['id'] as string, n]));
}

const fixture = loadFixture();
const flowById = loadCalibrationFlow();

/** The label the editor displays/measures: name, falling back to the type. */
function labelOf(n: MeasuredEntity): string {
  return n.name !== '' ? n.name : n.type;
}

function optsOf(n: MeasuredEntity): {
  inputs: number;
  outputs: number;
  hideLabel: boolean;
} {
  const flowNode = flowById.get(n.id);
  return {
    inputs: n.model.inputs ?? 0,
    outputs: n.model.outputs ?? 0,
    hideLabel: isNodeLabelHidden(n.type, flowNode),
  };
}

describe('nodeDimensionsFor vs the 4.1.11 editor fixture (table-driven, exact)', () => {
  it.each(fixture.nodes.map((n) => [n.id, n] as const))(
    'node %s matches the captured editor model {w, h}',
    (_id, n) => {
      const dims = nodeDimensionsFor(labelOf(n), optsOf(n));
      expect(dims.w, `${n.id} width`).toBe(n.model.w);
      expect(dims.h, `${n.id} height`).toBe(n.model.h);
    },
  );

  it.each(fixture.comments.map((c) => [c.id, c] as const))(
    'comment %s matches the captured editor model {w, h} (inputs/outputs 0)',
    (_id, c) => {
      const dims = nodeDimensionsFor(labelOf(c), { inputs: 0, outputs: 0 });
      expect(dims.w, `${c.id} width`).toBe(c.model.w);
      expect(dims.h, `${c.id} height`).toBe(c.model.h);
    },
  );

  it('label-hidden link nodes (l:false) are exactly 30×30', () => {
    for (const id of ['calib-link-in-s', 'calib-link-out-s']) {
      const n = fixture.nodes.find((x) => x.id === id);
      if (!n) throw new Error(`${id} missing from fixture`);
      expect(optsOf(n).hideLabel, `${id} hides its label`).toBe(true);
      expect(nodeDimensionsFor(labelOf(n), optsOf(n))).toEqual({ w: 30, h: 30 });
    }
  });

  it('input-port catalog agrees with the editor _def.inputs for every calibration node', () => {
    for (const n of fixture.nodes) {
      const flowNode = flowById.get(n.id);
      expect(getInputPortCount(n.type, flowNode), `${n.id} (${n.type}) inputs`).toBe(
        n.model.inputs ?? 0,
      );
    }
  });
});

describe("the audit's named F11 width cases (binding, exact)", () => {
  it("'Parse reading' computes 160 (the audit-measured editor width; was 107)", () => {
    expect(nodeDimensionsFor('Parse reading', { inputs: 1, outputs: 1 }).w).toBe(160);
  });

  it("'Debounce repeat alarms' computes 220 (the audit-measured editor width; was 163)", () => {
    expect(nodeDimensionsFor('Debounce repeat alarms', { inputs: 1, outputs: 1 }).w).toBe(220);
  });
});

describe('width-model properties', () => {
  const LADDER_BASE = 'Calibration width ladder 0123456789 ABCD';
  const samples = [
    ...Array.from({ length: LADDER_BASE.length + 1 }, (_, i) => LADDER_BASE.slice(0, i)),
    ...fixture.nodes.map(labelOf),
    ...fixture.comments.map(labelOf),
  ];

  it('w ≥ 100 and w ≡ 0 (mod 20) for every sample label and input arity', () => {
    for (const label of samples) {
      for (const inputs of [0, 1]) {
        const { w } = nodeDimensionsFor(label, { inputs, outputs: 1 });
        expect(w, `'${label}' (inputs ${inputs}) ≥ 100`).toBeGreaterThanOrEqual(100);
        expect(w % 20, `'${label}' (inputs ${inputs}) mod 20`).toBe(0);
      }
    }
  });

  it('monotonic: width never shrinks as the label grows', () => {
    for (let i = 1; i <= LADDER_BASE.length; i++) {
      const prev = nodeDimensionsFor(LADDER_BASE.slice(0, i - 1), { inputs: 1, outputs: 1 }).w;
      const cur = nodeDimensionsFor(LADDER_BASE.slice(0, i), { inputs: 1, outputs: 1 }).w;
      expect(cur, `width(len ${i}) ≥ width(len ${i - 1})`).toBeGreaterThanOrEqual(prev);
    }
  });

  it('no 240px cap: the 40-char ladder label is 340px wide', () => {
    expect(nodeDimensionsFor(LADDER_BASE, { inputs: 1, outputs: 1 }).w).toBe(340);
  });

  it('deterministic: identical inputs give identical outputs', () => {
    for (const label of samples) {
      expect(nodeDimensionsFor(label, { inputs: 1, outputs: 3 })).toEqual(
        nodeDimensionsFor(label, { inputs: 1, outputs: 3 }),
      );
    }
  });

  it('outputs drive height only: h = max(30, outputs·15), w untouched', () => {
    for (const outputs of [0, 1, 2, 3, 4, 6]) {
      const dims = nodeDimensionsFor('Switch four rules', { inputs: 1, outputs });
      expect(dims.h, `${outputs} outputs`).toBe(Math.max(30, outputs * 15));
      expect(dims.w, `${outputs} outputs leaves w alone`).toBe(
        nodeDimensionsFor('Switch four rules', { inputs: 1, outputs: 1 }).w,
      );
    }
  });

  it('whitespace measures like the editor span: trailing space and collapsed runs are free', () => {
    const base = labelWidthPx('Calibration');
    expect(labelWidthPx('Calibration ')).toBe(base);
    expect(labelWidthPx('  Calibration  ')).toBe(base);
    expect(labelWidthPx('Calibration  width')).toBe(labelWidthPx('Calibration width'));
  });
});

describe('port anchors pinned to the fixture table (counts 1–4)', () => {
  it('output-port centers reproduce the captured per-port-count table', () => {
    // Pin the TABLE (not the spacing formula): anchor = (w, capturedTopY + 5)
    // since the captured ys are 10×10 port-box tops and xFromRight is 5.
    for (const [count, entry] of Object.entries(fixture.outputPortOffsets)) {
      const outputs = Number(count);
      const w = 120; // arbitrary node width; x must land on the right edge
      const expected = entry.ys.map((y) => ({ x: w, y: y + 5 }));
      expect(outputPortAnchors(w, entry.h, outputs), `${count} outputs`).toEqual(expected);
    }
  });

  it('per-node DOM port boxes agree: every captured port equals its anchor − (5, 5)', () => {
    for (const n of fixture.nodes) {
      const anchors = outputPortAnchors(n.model.w, n.model.h, n.model.outputs ?? 0);
      expect(
        n.dom.outputPorts.map((p) => ({ x: p.x + 5, y: p.y + 5 })),
        `${n.id} output ports`,
      ).toEqual(anchors);
      if ((n.model.inputs ?? 0) > 0) {
        const [port] = n.dom.inputPorts;
        if (!port) throw new Error(`${n.id} captured no input port`);
        expect({ x: port.x + 5, y: port.y + 5 }, `${n.id} input port`).toEqual(
          inputPortAnchor(n.model.h),
        );
      }
    }
  });
});

describe('GeometryProvider (frozen contract #2)', () => {
  it('exposes the pinned 4.1 profile with the module functions (identity, not copies)', () => {
    expect(editorGeometryProvider.profile).toBe(EDITOR_GEOMETRY_PROFILE);
    expect(EDITOR_GEOMETRY_PROFILE).toBe('nodered-4.1');
    expect(editorGeometryProvider.nodeDimensionsFor).toBe(nodeDimensionsFor);
    expect(editorGeometryProvider.outputPortAnchors).toBe(outputPortAnchors);
    expect(editorGeometryProvider.inputPortAnchor).toBe(inputPortAnchor);
  });

  it('legacy nodeWidthFor wrapper delegates to the editor-true model (1-input assumption)', () => {
    expect(nodeWidthFor('Parse reading', false, 1)).toBe(160);
    expect(nodeWidthFor('Debounce repeat alarms', true, 1)).toBe(220);
  });
});
