/**
 * PNG rasterization for the deterministic SVG renderer (REND-5, F1).
 *
 * Wraps the OPTIONAL `@resvg/resvg-js` dependency behind a dynamic import.
 * When the rasterizer cannot be loaded (optional dep skipped at install
 * time, unsupported platform, broken native binding) every entry point
 * HARD-FAILS with `RasterizerUnavailableError` — there is deliberately no
 * silent SVG substitution: an agent that asked for pixels must never be
 * handed XML and told it was an image.
 *
 * Text is rendered exclusively with the bundled Inter Regular subset
 * (./fonts/inter-regular.ts, OFL-1.1) — system fonts are never loaded — so
 * PNG output is byte-stable across machines and platforms for the same
 * input SVG and resvg version (pinned exact in optionalDependencies).
 */

import { access, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sha256Hex } from '../../shared/hash.js';

import { INTER_REGULAR_FAMILY, INTER_REGULAR_TTF_BASE64 } from './fonts/inter-regular.js';

export const RASTERIZER_INSTALL_HINT =
  "PNG rendering requires the optional dependency '@resvg/resvg-js'. " +
  'Install it with `npm install @resvg/resvg-js` (it ships prebuilt ' +
  'binaries; no toolchain needed), or use render_flow_svg instead.';

/**
 * The PNG rasterizer is not loadable. Thrown by every rasterization entry
 * point — callers must surface this loudly, never degrade to SVG output.
 * The stdio transport serializes `name` into the structured error payload;
 * renaming breaks that contract.
 */
export class RasterizerUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RasterizerUnavailableError';
  }
}

export interface RasterizeOptions {
  /** Zoom factor applied to the SVG's intrinsic size. Default 1. */
  scale?: number;
}

export interface RasterizedPng {
  png: Buffer;
  width_px: number;
  height_px: number;
}

// The rule forbids inline import() type annotations, but `typeof import(...)`
// is the only way to type the OPTIONAL dependency without a top-level import
// (which would fail module resolution when the package is absent).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ResvgModule = typeof import('@resvg/resvg-js');

let resvgModulePromise: Promise<ResvgModule> | null = null;

async function importResvg(): Promise<ResvgModule> {
  resvgModulePromise ??= import('@resvg/resvg-js');
  try {
    return await resvgModulePromise;
  } catch (err) {
    // Reset so a post-install retry within the same process can succeed.
    resvgModulePromise = null;
    throw new RasterizerUnavailableError(
      `Failed to load '@resvg/resvg-js': ${err instanceof Error ? err.message : String(err)}. ${RASTERIZER_INSTALL_HINT}`,
      { cause: err },
    );
  }
}

/**
 * True when `@resvg/resvg-js` can be imported. Used by `health_check`
 * (`rasterizer_available`) and by stage-output enrichment (REND-8) to report
 * absence LOUDLY instead of substituting SVG.
 */
export async function rasterizerAvailable(): Promise<boolean> {
  try {
    await importResvg();
    return true;
  } catch {
    return false;
  }
}

let fontBuffer: Buffer | null = null;

/** Decoded bundled Inter Regular subset (cached). */
export function bundledFontBuffer(): Buffer {
  fontBuffer ??= Buffer.from(INTER_REGULAR_TTF_BASE64, 'base64');
  return fontBuffer;
}

let fontFilePromise: Promise<string> | null = null;

/**
 * Materialize the bundled font as a file for resvg's `fontFiles` option.
 *
 * resvg-js 2.6.2 silently IGNORES unknown option fields — passing the then
 * unreleased `fontBuffers` key makes the whole options struct fail NAPI
 * deserialization and fall back to defaults (loadSystemFonts: true), which
 * would quietly re-introduce system-font nondeterminism. `fontFiles` is the
 * supported 2.6.x API, so the embedded TTF is extracted once per process to
 * a CONTENT-ADDRESSED temp path (sha256 of the bytes in the name): concurrent
 * processes converge on the same file and a stale file can never carry
 * different bytes. Write is atomic (tmp + rename).
 */
export async function bundledFontFile(): Promise<string> {
  fontFilePromise ??= extractBundledFont();
  try {
    return await fontFilePromise;
  } catch (err) {
    fontFilePromise = null;
    throw err;
  }
}

async function extractBundledFont(): Promise<string> {
  const buf = bundledFontBuffer();
  const digest = sha256Hex(buf).slice(0, 16);
  const dest = path.join(os.tmpdir(), `flow-otter-inter-regular-${digest}.ttf`);
  try {
    await access(dest);
    return dest;
  } catch {
    // not yet extracted
  }
  const tmpPath = `${dest}.tmp-${String(process.pid)}`;
  await writeFile(tmpPath, buf);
  await rename(tmpPath, dest);
  return dest;
}

/**
 * Rasterize an SVG document to PNG using only the bundled font.
 *
 * Throws `RasterizerUnavailableError` when `@resvg/resvg-js` is not
 * loadable (HARD-FAIL — no silent SVG substitution).
 */
export async function rasterizeSvg(
  svg: string,
  opts: RasterizeOptions = {},
): Promise<RasterizedPng> {
  const { Resvg } = await importResvg();
  const fontFile = await bundledFontFile();
  const scale = opts.scale ?? 1;
  const resvg = new Resvg(svg, {
    ...(scale !== 1 ? { fitTo: { mode: 'zoom', value: scale } } : {}),
    font: {
      loadSystemFonts: false,
      fontFiles: [fontFile],
      defaultFontFamily: INTER_REGULAR_FAMILY,
      sansSerifFamily: INTER_REGULAR_FAMILY,
      serifFamily: INTER_REGULAR_FAMILY,
      monospaceFamily: INTER_REGULAR_FAMILY,
    },
  });
  const rendered = resvg.render();
  return {
    png: rendered.asPng(),
    width_px: rendered.width,
    height_px: rendered.height,
  };
}
