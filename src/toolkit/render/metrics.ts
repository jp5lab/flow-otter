import {
  ELLIPSIS_WIDTH,
  FALLBACK_GLYPH_WIDTH,
  HELVETICA_GLYPH_WIDTHS,
  HELVETICA_UNITS_PER_EM,
  NODE_LABEL_FONT_SIZE_PX,
} from './glyph-widths.js';

const ELLIPSIS = '…';

export const NODE_HORIZONTAL_PADDING_PX = 12;
export const NODE_ICON_WIDTH_PX = 20;
export const NODE_PORT_PADDING_PX = 8;
export const MIN_NODE_WIDTH_PX = 80;
export const MAX_NODE_WIDTH_PX = 240;

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

function pxFromUnits(units: number): number {
  return Math.round((units * NODE_LABEL_FONT_SIZE_PX) / HELVETICA_UNITS_PER_EM);
}

/**
 * Computes a canvas-true node width in pixels for the given label and node
 * shape. Performs all sums in integer font-units, converting once at the end
 * to integer pixels — keeps output deterministic across runs.
 */
export function nodeWidthFor(label: string, hasIcon: boolean, outputPorts: number): number {
  const labelUnits = measureLabel(label);
  const labelPx = pxFromUnits(labelUnits);
  const iconPx = hasIcon ? NODE_ICON_WIDTH_PX : 0;
  const portPx = outputPorts > 0 ? NODE_PORT_PADDING_PX : 0;
  const raw = NODE_HORIZONTAL_PADDING_PX + iconPx + labelPx + portPx + NODE_HORIZONTAL_PADDING_PX;
  return Math.max(MIN_NODE_WIDTH_PX, Math.min(MAX_NODE_WIDTH_PX, raw));
}
