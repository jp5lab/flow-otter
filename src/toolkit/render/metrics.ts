/**
 * Editor-true node geometry (REND-2, frozen contract #2: GeometryProvider).
 *
 * Single source of node dimensions (w AND h) and port anchors for the whole
 * toolkit — the SVG renderer, compile's group auto-fit, and (later phases)
 * layout lint, placement, and the layout engine all consume THIS module so
 * the geometry can never fork again.
 *
 * The model replicates the Node-RED 4.1 editor exactly (verified against the
 * editor source and pinned by tests/fixtures/editor-metrics/nodered-4.1.11.json):
 *
 *   labelPx = round(measured label width @14px)      // offsetWidth emulation
 *   w = hideLabel ? 30 : max(100, 20·ceil((labelPx + 50 + (inputs>0 ? 7 : 0)) / 20))
 *   h = max(30, outputs·15)
 *
 * The editor measures labels with an offscreen HTML span (integer
 * `offsetWidth`, whitespace collapsed/trimmed by HTML layout + the editor's
 * per-line trim) — see glyph-widths.ts for why the REGULAR Helvetica Neue
 * advances are the right basis. The flat 50px label margin covers the
 * universal 30px icon column plus paddings; per the 4.1.11 fixture NO
 * per-type icon/button override shifts dimensions (inject/debug buttons and
 * icons are already inside the 50), so `hasIcon`/`hasButton` are accepted
 * for forward compatibility but do not currently alter the result.
 *
 * Version pinning: compile/auto-fit consumes this one profile (4.1)
 * PERMANENTLY regardless of target runtime — `compile()` stays pure. The
 * REND-1 cross-version drift test proved 5.0.0 dimensions identical to
 * 4.1.11 (and 4.0.x is recorded as dimension-identical), so the
 * version-keyed-profile contingency does not fire; if a future re-capture
 * ever drifts, version-keyed profiles may apply to render/lint paths only.
 */
import {
  ELLIPSIS_WIDTH,
  FALLBACK_GLYPH_WIDTH,
  HELVETICA_GLYPH_WIDTHS,
  HELVETICA_UNITS_PER_EM,
  NODE_LABEL_FONT_SIZE_PX,
} from './glyph-widths.js';

const ELLIPSIS = '…';

/** Editor `node_width`: minimum width of any labeled node. */
export const MIN_NODE_WIDTH_PX = 100;
/** Editor `node_height`: body height of a single-line, ≤2-output node. */
export const NODE_BODY_HEIGHT_PX = 30;
/** Flat label margin (30px icon column + paddings) reserved on every labeled node. */
export const NODE_LABEL_MARGIN_PX = 50;
/** Extra width when the node has an input port (`_def.inputs > 0`). */
export const INPUT_HANDLE_PX = 7;
/** Widths snap up to this grid. */
export const WIDTH_GRID_PX = 20;
/** Per-output-port height contribution: h = max(30, outputs·15). */
export const OUTPUT_PORT_PITCH_PX = 15;
/** Label-hidden nodes (link nodes with `l:false`) render as this square. */
export const HIDDEN_LABEL_NODE_SIZE_PX = 30;
/** Port boxes are 10×10 and overhang the node edge by 5px. */
export const PORT_BOX_SIZE_PX = 10;
export const PORT_OVERHANG_PX = 5;
/** Vertical spacing between adjacent output-port centers. */
export const OUTPUT_PORT_SPACING_PX = 13;

function widthOfChar(ch: string): number {
  const known = HELVETICA_GLYPH_WIDTHS[ch];
  return known ?? FALLBACK_GLYPH_WIDTH;
}

/** Returns the label width in font-units (1000 per em). */
export function measureLabel(label: string): number {
  let total = 0;
  for (const ch of label) total += widthOfChar(ch);
  return total;
}

/**
 * Truncates a label with a trailing ellipsis until its measured width fits
 * within `maxWidthUnits` (font-units). Returns the original label if it
 * already fits. May return just the ellipsis if no room for any glyph.
 */
export function fitLabel(label: string, maxWidthUnits: number): string {
  if (measureLabel(label) <= maxWidthUnits) return label;
  if (maxWidthUnits <= ELLIPSIS_WIDTH) return ELLIPSIS;
  const budget = maxWidthUnits - ELLIPSIS_WIDTH;
  let acc = 0;
  let cut = 0;
  for (const ch of label) {
    const w = widthOfChar(ch);
    if (acc + w > budget) break;
    acc += w;
    cut += ch.length;
  }
  return label.slice(0, cut) + ELLIPSIS;
}

/**
 * Label width in integer pixels, emulating the editor's measurement span:
 * HTML layout collapses whitespace runs and the editor trims each line, then
 * reads integer `offsetWidth`. All sums happen in integer font-units with a
 * single scale + round at the end — deterministic across platforms.
 */
export function labelWidthPx(label: string): number {
  const normalized = label.replace(/\s+/g, ' ').trim();
  const units = measureLabel(normalized);
  return Math.round((units * NODE_LABEL_FONT_SIZE_PX) / HELVETICA_UNITS_PER_EM);
}

export interface NodeDimensionOpts {
  /** Accepted for forward compatibility; the 4.1 profile reserves the icon column unconditionally. */
  readonly hasIcon?: boolean;
  /** Input-port count (`_def.inputs`); > 0 adds the 7px input handle. Default 1. */
  readonly inputs?: number;
  /** Output-port count; drives height. Default 1. */
  readonly outputs?: number;
  /** Accepted for forward compatibility; buttons do not shift 4.1 dimensions. */
  readonly hasButton?: boolean;
  /** Label hidden (link nodes with `l:false`, or by default) → 30×30 pill. */
  readonly hideLabel?: boolean;
}

export interface NodeDimensions {
  readonly w: number;
  readonly h: number;
}

/**
 * Editor-true node dimensions for a label and node shape (4.1 profile).
 * Also correct for comment nodes (inputs: 0, outputs: 0 → min-100 widths,
 * 30px tall — the editor sizes comments through the same formula).
 */
export function nodeDimensionsFor(label: string, opts: NodeDimensionOpts = {}): NodeDimensions {
  const outputs = opts.outputs ?? 1;
  const h = Math.max(NODE_BODY_HEIGHT_PX, outputs * OUTPUT_PORT_PITCH_PX);
  if (opts.hideLabel === true) {
    return { w: HIDDEN_LABEL_NODE_SIZE_PX, h };
  }
  const inputs = opts.inputs ?? 1;
  const handle = inputs > 0 ? INPUT_HANDLE_PX : 0;
  const raw = labelWidthPx(label) + NODE_LABEL_MARGIN_PX + handle;
  const w = Math.max(MIN_NODE_WIDTH_PX, WIDTH_GRID_PX * Math.ceil(raw / WIDTH_GRID_PX));
  return { w, h };
}

/** A port anchor (port-box CENTER), relative to the node's top-left corner. */
export interface PortAnchor {
  readonly x: number;
  readonly y: number;
}

/**
 * Output-port centers for a node of the given w/h: x sits ON the right edge
 * (the 10×10 port box overhangs by 5), ys are spaced 13px apart, symmetric
 * about h/2. Reproduces the fixture's pinned per-port-count table exactly.
 */
export function outputPortAnchors(w: number, h: number, outputs: number): PortAnchor[] {
  const anchors: PortAnchor[] = [];
  for (let i = 0; i < outputs; i++) {
    anchors.push({ x: w, y: h / 2 + (i - (outputs - 1) / 2) * OUTPUT_PORT_SPACING_PX });
  }
  return anchors;
}

/** Input-port center: on the left edge at mid-height (box overhangs by 5). */
export function inputPortAnchor(h: number): PortAnchor {
  return { x: 0, y: h / 2 };
}

/**
 * Frozen contract #2 — the single geometry source consumed by render,
 * compile auto-fit, and (later) layout lint / placement / engine.
 */
export interface GeometryProvider {
  /** Provider identity — downstream acceptance tests assert on this so any future swap is loud. */
  readonly profile: string;
  nodeDimensionsFor(this: void, label: string, opts?: NodeDimensionOpts): NodeDimensions;
  outputPortAnchors(this: void, w: number, h: number, outputs: number): PortAnchor[];
  inputPortAnchor(this: void, h: number): PortAnchor;
}

export const EDITOR_GEOMETRY_PROFILE = 'nodered-4.1';

export const editorGeometryProvider: GeometryProvider = Object.freeze({
  profile: EDITOR_GEOMETRY_PROFILE,
  nodeDimensionsFor,
  outputPortAnchors,
  inputPortAnchor,
});

/**
 * Legacy width entry point — thin wrapper over `nodeDimensionsFor` kept
 * during the migration (REND-3 moves the renderer onto the full provider).
 * Assumes 1 input (the common case) when only output count is known.
 */
export function nodeWidthFor(label: string, hasIcon: boolean, outputPorts: number): number {
  return nodeDimensionsFor(label, { hasIcon, outputs: outputPorts }).w;
}
