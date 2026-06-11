/**
 * REND-8 render-failure injection: when the SVG renderer itself throws, the
 * stage MUST still succeed with `render: null` on the output — and the staged
 * bytes MUST equal the literals pinned at pre-REND-8 HEAD (hash invariance
 * with enrichment failing at runtime). The renderer is mocked at the module
 * seam `_stage-render.ts` imports from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import { getStagedChangeTool } from '../../../../../src/server/tools/read/get-staged-change.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import type * as SvgModule from '../../../../../src/toolkit/render/svg.js';

import {
  buildRenderCtx,
  PIN_COMMENT_INPUT,
  PINNED_STAGED_HASH,
  PINNED_STAGED_RECORD_HASH,
  type RenderCtxHarness,
} from './_stage-render-fixture.js';

vi.mock('../../../../../src/toolkit/render/svg.js', async (importOriginal) => {
  const actual: typeof SvgModule = await importOriginal();
  return {
    ...actual,
    renderSvg: (): string => {
      throw new Error('injected renderer failure (REND-8 drill)');
    },
  };
});

let harness: RenderCtxHarness;

beforeEach(async () => {
  harness = await buildRenderCtx();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('REND-8 render-failure injection', () => {
  it('a throwing renderer never fails the stage; output carries render: null', async () => {
    const out = (await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx)) as {
      ok: boolean;
      staged_hash: string;
      render: unknown;
    };

    expect(out.ok).toBe(true);
    expect(out.render).toBeNull();

    // Hash invariance under failed enrichment: same literals as the
    // pre-REND-8 pin and the happy-path run.
    expect(out.staged_hash).toBe(PINNED_STAGED_HASH);
    const record = await harness.staging.read();
    expect(record).not.toBeNull();
    expect(canonicalHash(record!.flows)).toBe(PINNED_STAGED_HASH);
    expect(canonicalHash(record)).toBe(PINNED_STAGED_RECORD_HASH);
  });

  it('no sidecar is written on failure — get_staged_change serves render: null', async () => {
    await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx);

    const read = await getStagedChangeTool.handler({}, harness.ctx);
    expect(read.staged).not.toBeNull();
    expect(read.staged!.staged_hash).toBe(PINNED_STAGED_HASH);
    expect(read.staged!.render).toBeNull();
  });
});
