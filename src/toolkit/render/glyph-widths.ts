/**
 * Helvetica Neue (regular) glyph advance widths in 1000-units-per-em.
 * Used for editor-true node-width calculation (REND-2).
 *
 * Source: advance widths extracted from the `HelveticaNeue` face of macOS
 * `HelveticaNeue.ttc` (`hmtx` table, ASCII range U+0020..U+007E + U+2026).
 * Advance widths only (no font outlines), so no font-licensing concerns.
 *
 * Why the REGULAR face, not italic: the Node-RED editor renders node labels
 * italic (SVG `.red-ui-flow-node-label`), but it MEASURES them with an
 * offscreen HTML `<span class="red-ui-flow-node-label">` whose computed
 * `font-style` resolves to `normal` (the italic rule is scoped to the SVG
 * canvas). Verified live against Node-RED 4.1.11 over CDP (2026-06-10):
 * `getComputedStyle` of the measurement span reports `font-style: normal`,
 * `font-size: 14px`, family `"Helvetica Neue", Arial, Helvetica, sans-serif`.
 * These regular-face advances reproduce every node width in
 * tests/fixtures/editor-metrics/nodered-4.1.11.json exactly (pinned by
 * tests/unit/toolkit/render/metrics-editor-truth.test.ts); the
 * previously-used Adobe Helvetica AFM table missed three bucket boundaries.
 */

export const HELVETICA_UNITS_PER_EM = 1000;

const RAW: Readonly<Record<string, number>> = {
  ' ': 278,
  '!': 259,
  '"': 426,
  '#': 556,
  $: 556,
  '%': 1000,
  '&': 630,
  "'": 278,
  '(': 259,
  ')': 259,
  '*': 352,
  '+': 600,
  ',': 278,
  '-': 389,
  '.': 278,
  '/': 333,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  ':': 278,
  ';': 278,
  '<': 600,
  '=': 600,
  '>': 600,
  '?': 556,
  '@': 800,
  A: 648,
  B: 685,
  C: 722,
  D: 704,
  E: 611,
  F: 574,
  G: 759,
  H: 722,
  I: 259,
  J: 519,
  K: 667,
  L: 556,
  M: 871,
  N: 722,
  O: 760,
  P: 648,
  Q: 760,
  R: 685,
  S: 648,
  T: 574,
  U: 722,
  V: 611,
  W: 926,
  X: 611,
  Y: 648,
  Z: 611,
  '[': 259,
  '\\': 333,
  ']': 259,
  '^': 600,
  _: 500,
  '`': 222,
  a: 537,
  b: 593,
  c: 537,
  d: 593,
  e: 537,
  f: 296,
  g: 574,
  h: 556,
  i: 222,
  j: 222,
  k: 519,
  l: 222,
  m: 853,
  n: 556,
  o: 574,
  p: 593,
  q: 593,
  r: 333,
  s: 500,
  t: 315,
  u: 556,
  v: 500,
  w: 758,
  x: 518,
  y: 500,
  z: 480,
  '{': 333,
  '|': 222,
  '}': 333,
  '~': 600,
};

export const HELVETICA_GLYPH_WIDTHS: Readonly<Record<string, number>> = Object.freeze({ ...RAW });

/** Width to use for any character not in the table (mid-range). */
export const FALLBACK_GLYPH_WIDTH = 556;

/** Width of the U+2026 horizontal ellipsis glyph in Helvetica Neue. */
export const ELLIPSIS_WIDTH = 1000;

/**
 * Font size, in pixels, used by the Node-RED editor for node labels
 * (REND-1 fixture `labelStyle.fontSize`; was 12 before REND-2).
 */
export const NODE_LABEL_FONT_SIZE_PX = 14;
