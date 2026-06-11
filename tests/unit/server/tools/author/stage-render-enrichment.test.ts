/**
 * REND-8 stage-output render enrichment: shape + semantics.
 *
 * - before/after differ on a node-add (the whole point: the agent can SEE
 *   what the stage changed without extra invocations),
 * - SVG always, PNG only when the rasterizer imports (it does in dev — the
 *   optional @resvg/resvg-js is install-pinned),
 * - render entries are scoped to TOUCHED tabs only,
 * - tabs absent on one side (created/removed) carry null for that side,
 * - get_staged_change re-surfaces the render block for exactly the pending
 *   stage (sidecar keyed by staged_hash), null on any mismatch.
 *
 * Hash invariance lives in stage-render-hash-invariance.test.ts (test-first,
 * green at pre-REND-8 HEAD); failure paths live in
 * stage-render-failure-injection.test.ts / stage-render-rasterizer-absent.test.ts.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import { addNodeTool } from '../../../../../src/server/tools/author/add-node.js';
import {
  buildStageRenderEnrichment,
  type StageRender,
} from '../../../../../src/server/tools/author/_stage-render.js';
import { getStagedChangeTool } from '../../../../../src/server/tools/read/get-staged-change.js';
import { isTab, type FlowsJson } from '../../../../../src/shared/flows-json.js';

import {
  buildRenderCtx,
  FIXTURE_FLOWS,
  FIXTURE_HASH,
  PIN_COMMENT_INPUT,
  type RenderCtxHarness,
} from './_stage-render-fixture.js';

interface StageOutput {
  ok: boolean;
  staged_hash: string;
  render: StageRender | null;
}

const TAB_ID = FIXTURE_FLOWS.find((n) => isTab(n))!.id;

let harness: RenderCtxHarness;

beforeEach(async () => {
  harness = await buildRenderCtx();
});

afterEach(async () => {
  await harness.cleanup();
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('REND-8 stage-output render enrichment (shape)', () => {
  it('a node-add emits before/after SVG+PNG paths for the touched tab, before ≠ after', async () => {
    const out = (await addNodeTool.handler(
      { tab_id: TAB_ID, type: 'debug', opts: { position: { x: 300, y: 100 } } },
      harness.ctx,
    )) as StageOutput;

    expect(out.ok).toBe(true);
    expect(out.render).not.toBeNull();
    const render = out.render!;
    // Dev installs pin the optional rasterizer, so PNGs must be present here.
    expect(render.rasterizer_available).toBe(true);
    expect(render.tabs).toHaveLength(1);

    const entry = render.tabs[0]!;
    expect(entry.tab_id).toBe(TAB_ID);
    for (const p of [entry.before_svg, entry.after_svg, entry.before_png, entry.after_png]) {
      expect(p).not.toBeNull();
      expect(path.isAbsolute(p!)).toBe(true);
      expect(p!.startsWith(harness.renderDir + path.sep)).toBe(true);
    }

    const beforeSvg = await readFile(entry.before_svg!, 'utf8');
    const afterSvg = await readFile(entry.after_svg!, 'utf8');
    expect(beforeSvg).toContain('<svg');
    expect(afterSvg).toContain('<svg');
    expect(afterSvg).not.toBe(beforeSvg);

    const beforePng = await readFile(entry.before_png!);
    const afterPng = await readFile(entry.after_png!);
    expect(beforePng.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(afterPng.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(afterPng.equals(beforePng)).toBe(false);

    // The enriched output still validates against the tool's OutputSchema.
    expect(() => addNodeTool.outputZod!.parse(out)).not.toThrow();
  });

  it('get_staged_change re-surfaces the render block for the pending stage', async () => {
    const out = (await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx)) as StageOutput;
    expect(out.render).not.toBeNull();

    const read = await getStagedChangeTool.handler({}, harness.ctx);
    expect(read.staged).not.toBeNull();
    expect(read.staged!.render).toEqual(out.render);
    expect(() => getStagedChangeTool.outputZod!.parse(read)).not.toThrow();
  });

  it('a stage whose hash does not match the render sidecar gets render: null', async () => {
    await addCommentTool.handler(PIN_COMMENT_INPUT, harness.ctx);
    await harness.staging.clear();

    // Fabricate a different pending stage WITHOUT going through the pipeline:
    // the sidecar on disk still describes the previous stage, so its hash
    // cannot match and the render block must not be served.
    await harness.staging.write({
      flows: FIXTURE_FLOWS,
      basedOnSnapshotHash: FIXTURE_HASH,
      basedOnRev: null,
      stagedHash: 'f'.repeat(64),
      stagedAt: '2026-04-30T00:00:00.000Z',
      actor: 'unit-test',
      agent_id: 'pid-test',
      reason: 'fabricated stage',
    });

    const read = await getStagedChangeTool.handler({}, harness.ctx);
    expect(read.staged).not.toBeNull();
    expect(read.staged!.render).toBeNull();
  });
});

describe('REND-8 touched-tab scoping (buildStageRenderEnrichment)', () => {
  it('renders only tabs whose canvas content changed', async () => {
    const tab2: FlowsJson[number] = { id: 'tab2x', type: 'tab', label: 'Aux' };
    const note = {
      id: 'note2x',
      type: 'comment',
      z: 'tab2x',
      name: 'aux note',
      x: 100,
      y: 40,
    } as unknown as FlowsJson[number];
    const prior: FlowsJson = [...FIXTURE_FLOWS, tab2, note];
    const staged: FlowsJson = prior.map((n) => (n.id === 'note2x' ? { ...n, x: 140 } : n));

    const render = await buildStageRenderEnrichment(harness.ctx, prior, staged, 'hash-unused');
    expect(render).not.toBeNull();
    // tab1 is untouched — only tab2x renders.
    expect(render!.tabs.map((t) => t.tab_id)).toEqual(['tab2x']);
    expect(render!.tabs[0]!.before_svg).not.toBeNull();
    expect(render!.tabs[0]!.after_svg).not.toBeNull();
  });

  it('a newly created tab has before_* null; a removed tab has after_* null', async () => {
    const tab2: FlowsJson[number] = { id: 'tab2x', type: 'tab', label: 'New' };
    const note = {
      id: 'note2x',
      type: 'comment',
      z: 'tab2x',
      name: 'fresh',
      x: 100,
      y: 40,
    } as unknown as FlowsJson[number];
    const withTab2: FlowsJson = [...FIXTURE_FLOWS, tab2, note];

    const created = await buildStageRenderEnrichment(
      harness.ctx,
      FIXTURE_FLOWS,
      withTab2,
      'hash-unused',
    );
    const createdEntry = created!.tabs.find((t) => t.tab_id === 'tab2x')!;
    expect(createdEntry.before_svg).toBeNull();
    expect(createdEntry.before_png).toBeNull();
    expect(createdEntry.after_svg).not.toBeNull();

    const removed = await buildStageRenderEnrichment(
      harness.ctx,
      withTab2,
      FIXTURE_FLOWS,
      'hash-unused',
    );
    const removedEntry = removed!.tabs.find((t) => t.tab_id === 'tab2x')!;
    expect(removedEntry.after_svg).toBeNull();
    expect(removedEntry.after_png).toBeNull();
    expect(removedEntry.before_svg).not.toBeNull();
  });

  it('changes outside any tab canvas (config-only) yield an empty tabs list', async () => {
    const configNode = {
      id: 'cfg1',
      type: 'mqtt-broker',
      name: 'broker',
      broker: 'localhost',
      port: '1883',
    } as unknown as FlowsJson[number];
    const staged: FlowsJson = [...FIXTURE_FLOWS, configNode];

    const render = await buildStageRenderEnrichment(
      harness.ctx,
      FIXTURE_FLOWS,
      staged,
      'hash-unused',
    );
    expect(render).not.toBeNull();
    expect(render!.tabs).toEqual([]);
  });
});
