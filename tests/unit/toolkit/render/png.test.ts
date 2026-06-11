import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  INTER_OFL_LICENSE,
  INTER_REGULAR_FAMILY,
  INTER_REGULAR_TTF_BASE64,
} from '../../../../src/toolkit/render/fonts/inter-regular.js';
import {
  bundledFontBuffer,
  rasterizeSvg,
  rasterizerAvailable,
} from '../../../../src/toolkit/render/png.js';
import { renderSvg } from '../../../../src/toolkit/render/svg.js';
import type { FlowsJson } from '../../../../src/shared/flows-json.js';

/**
 * REND-5 — PNG rasterization (F1).
 *
 * Pins: PNG magic bytes + dimensions, scale handling, and the golden e1
 * fixture render. The golden is unconditional (no env gate) because the
 * rasterizer uses ONLY the bundled Inter subset — system fonts are never
 * loaded — so the bytes are stable across machines for a pinned
 * @resvg/resvg-js version (exact in optionalDependencies).
 *
 * Golden re-bless protocol (mirrors svg.test.ts): a golden may only be
 * regenerated alongside a code change that names the geometry/rendering it
 * changes, never to "fix CI". Regenerate via:
 *   renderSvg(e1.flows, { tabId: E1_TAB }) → rasterizeSvg(svg).png
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const SMALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="50">' +
  '<rect width="120" height="50" fill="#ffffff"/>' +
  '<text x="8" y="25" font-family="Arial,sans-serif" font-size="14" fill="#333333">Hi otter</text>' +
  '</svg>';

interface E1Fixture {
  flows: FlowsJson;
  rev: string;
}

const E1_TAB = 'f6f2187d.f17ca8';

function loadE1(): E1Fixture {
  const p = fileURLToPath(
    new URL('../../../fixtures/audit-2026-06-10/e1-flows.json', import.meta.url),
  );
  return JSON.parse(readFileSync(p, 'utf8')) as E1Fixture;
}

function loadGolden(): Buffer {
  const p = fileURLToPath(
    new URL('../../../fixtures/audit-2026-06-10/e1-tab.golden.png', import.meta.url),
  );
  return readFileSync(p);
}

describe('bundled font module (OFL Inter subset)', () => {
  it('decodes to a TTF with the OFL license embedded', () => {
    const buf = Buffer.from(INTER_REGULAR_TTF_BASE64, 'base64');
    // sfnt version 0x00010000 = TrueType outlines.
    expect(buf.readUInt32BE(0)).toBe(0x00010000);
    expect(buf.length).toBeGreaterThan(10_000);
    expect(INTER_REGULAR_FAMILY).toBe('Inter');
    expect(INTER_OFL_LICENSE).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(INTER_OFL_LICENSE).toContain('The Inter Project Authors');
    // The cached helper returns the same decoded bytes.
    expect(bundledFontBuffer().equals(buf)).toBe(true);
  });
});

describe('rasterizeSvg (REND-5)', () => {
  it('rasterizer is available in the dev environment', async () => {
    await expect(rasterizerAvailable()).resolves.toBe(true);
  });

  it('produces a PNG with correct magic bytes and intrinsic dimensions', async () => {
    const out = await rasterizeSvg(SMALL_SVG);
    expect(out.png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(out.width_px).toBe(120);
    expect(out.height_px).toBe(50);
    // IHDR width/height (big-endian at offsets 16/20) agree with the report.
    expect(out.png.readUInt32BE(16)).toBe(120);
    expect(out.png.readUInt32BE(20)).toBe(50);
  });

  it('scale multiplies the output dimensions', async () => {
    const out = await rasterizeSvg(SMALL_SVG, { scale: 2 });
    expect(out.width_px).toBe(240);
    expect(out.height_px).toBe(100);
  });

  it('renders text with the bundled font (glyphs change the pixels)', async () => {
    const withText = await rasterizeSvg(SMALL_SVG);
    const blank = await rasterizeSvg(SMALL_SVG.replace('Hi otter', ''));
    expect(withText.png.equals(blank.png)).toBe(false);
  });

  it('is deterministic for the same input', async () => {
    const a = await rasterizeSvg(SMALL_SVG);
    const b = await rasterizeSvg(SMALL_SVG);
    expect(a.png.equals(b.png)).toBe(true);
  });

  it('golden: the e1 audit fixture rasterizes byte-identically', async () => {
    const e1 = loadE1();
    const svg = renderSvg(e1.flows, { tabId: E1_TAB });
    const out = await rasterizeSvg(svg);
    expect(out.width_px).toBe(1664);
    expect(out.height_px).toBe(624);
    const golden = loadGolden();
    expect(out.png.equals(golden), 'e1 PNG differs from the committed golden').toBe(true);
  });
});
