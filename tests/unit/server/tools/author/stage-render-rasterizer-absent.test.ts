/**
 * REND-8 rasterizer-absent path: when the optional @resvg/resvg-js cannot be
 * imported, the stage still succeeds, SVG paths are emitted, and PNG absence
 * is LOUD — `before_png`/`after_png` null with `rasterizer_available: false`
 * — never a silent SVG-for-PNG substitution. Staged bytes stay pinned to the
 * pre-REND-8 literals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import type { StageRender } from '../../../../../src/server/tools/author/_stage-render.js';
import { getStagedChangeTool } from '../../../../../src/server/tools/read/get-staged-change.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import type * as PngModule from '../../../../../src/toolkit/render/png.js';

import {
  buildRenderCtx,
  PIN_COMMENT_INPUT,
  PINNED_STAGED_HASH,
  PINNED_STAGED_RECORD_HASH,
  type RenderCtxHarness,
} from './_stage-render-fixture.js';

vi.mock('../../../../../src/toolkit/render/png.js', async (importOriginal) => {
  const actual: typeof PngModule = await importOriginal();
  return {
    ...actual,
    rasterizerAvailable: (): Promise<boolean> => Promise.resolve(false),
    rasterizeSvg: (): Promise<never> =>
      Promise.reject(new actual.RasterizerUnavailableError('mocked absent (REND-8 drill)')),
  };
});

let harness: RenderCtxHarness;

beforeEach(async () => {
  harness = await buildRenderCtx();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('REND-8 rasterizer-absent path', () => {
  it('stage succeeds with SVG paths, null PNGs, and rasterizer_available: false', async () => {
    const out = (await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx)) as {
      ok: boolean;
      staged_hash: string;
      render: StageRender | null;
    };

    expect(out.ok).toBe(true);
    expect(out.render).not.toBeNull();
    expect(out.render!.rasterizer_available).toBe(false);
    expect(out.render!.tabs).toHaveLength(1);
    const entry = out.render!.tabs[0]!;
    expect(entry.before_svg).not.toBeNull();
    expect(entry.after_svg).not.toBeNull();
    expect(entry.before_png).toBeNull();
    expect(entry.after_png).toBeNull();

    // Staged bytes unchanged by the degraded enrichment.
    expect(out.staged_hash).toBe(PINNED_STAGED_HASH);
    const record = await harness.staging.read();
    expect(canonicalHash(record!.flows)).toBe(PINNED_STAGED_HASH);
    expect(canonicalHash(record)).toBe(PINNED_STAGED_RECORD_HASH);
  });

  it('get_staged_change re-surfaces the degraded render block honestly', async () => {
    const out = (await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx)) as {
      render: StageRender | null;
    };

    const read = await getStagedChangeTool.handler({}, harness.ctx);
    expect(read.staged).not.toBeNull();
    expect(read.staged!.render).toEqual(out.render);
    expect(read.staged!.render!.rasterizer_available).toBe(false);
  });
});
