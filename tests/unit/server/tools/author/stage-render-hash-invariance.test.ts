/**
 * REND-8 test-first pin (2026-06-10 layout-audit fix plan): staged-byte
 * identity with/without render enrichment.
 *
 * Written and shown green at pre-REND-8 HEAD (commit 85594eb) BEFORE the
 * enrichment landed. The hashes are LITERALS captured at that HEAD, so this
 * suite proves the safety sketch line "pinned by hash byte-identity
 * with/without enrichment": if REND-8's post-`staging.write` render
 * enrichment ever changes the staged flows, the staged hash, or any other
 * byte of the staged.json record, these tests fail.
 *
 * The companion suites extend the same pin to the enrichment-failure paths:
 * - stage-render-failure-injection.test.ts (renderer throws → same literals)
 * - stage-render-rasterizer-absent.test.ts (no rasterizer → same literals)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';

import {
  buildRenderCtx,
  FIXTURE_HASH,
  PIN_COMMENT_INPUT,
  PINNED_STAGED_HASH,
  PINNED_STAGED_RECORD_HASH,
  type RenderCtxHarness,
} from './_stage-render-fixture.js';

let harness: RenderCtxHarness;

beforeEach(async () => {
  harness = await buildRenderCtx();
});

afterEach(async () => {
  await harness.cleanup();
});

describe('REND-8 staged-byte identity (pinned at pre-enrichment HEAD)', () => {
  it('staging the canonical fixture op yields the pinned staged_hash', async () => {
    const out = (await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx)) as {
      staged_hash: string;
      based_on_snapshot_hash: string;
    };

    expect(out.staged_hash).toBe(PINNED_STAGED_HASH);
    expect(out.based_on_snapshot_hash).toBe(FIXTURE_HASH);

    const record = await harness.staging.read();
    expect(record).not.toBeNull();
    expect(record!.stagedHash).toBe(PINNED_STAGED_HASH);
    expect(canonicalHash(record!.flows)).toBe(PINNED_STAGED_HASH);
    expect(record!.basedOnSnapshotHash).toBe(FIXTURE_HASH);
  });

  it('the entire staged.json record is byte-stable — enrichment is output-only', async () => {
    await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx);

    const record = await harness.staging.read();
    expect(record).not.toBeNull();
    // The full record (flows, hashes, rev, stagedAt, actor, agent_id, reason)
    // hashes to the literal captured before enrichment existed — REND-8 must
    // never write render state into the staging slot.
    expect(canonicalHash(record)).toBe(PINNED_STAGED_RECORD_HASH);
    expect(Object.keys(record as Record<string, unknown>)).not.toContain('render');
  });
});
