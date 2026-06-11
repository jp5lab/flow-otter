/**
 * REND-8 (2026-06-10 layout-audit fix plan, D5 second half): before/after
 * render paths on stage outputs.
 *
 * Executed INSIDE `compileValidateAndStage` — strictly AFTER `staging.write`
 * — so per-op author tools AND future `stage_changes` batches share one
 * enrichment point. The enrichment is OUTPUT-ONLY by contract: it can never
 * change the staged bytes, `staged_hash`, `based_on_snapshot_hash`, the
 * single-slot guard, or drift refusal (pinned by the
 * stage-render-hash-invariance suite against literals captured pre-REND-8).
 * Any enrichment failure yields `render: null` on the stage output — it must
 * never fail the stage.
 *
 * For every tab the stage touched, the prior (runtime) and staged flows are
 * rendered to files under `RENDER_DIR`: SVG always, PNG only when the
 * optional `@resvg/resvg-js` rasterizer imports. PNG absence is LOUD —
 * `before_png`/`after_png` are `null` and `rasterizer_available` says why;
 * SVG is never silently substituted for a requested image.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { isTab, type FlowsJson } from '../../../shared/flows-json.js';
import { canonicalHash } from '../../../shared/hash.js';
import { rasterizeSvg, rasterizerAvailable } from '../../../toolkit/render/png.js';
import { renderSvg } from '../../../toolkit/render/svg.js';
import type { ToolContext } from '../_tool.js';

export const StageRenderTabSchema = z.object({
  tab_id: z.string(),
  /** Absolute path to the prior-runtime SVG; null when the tab is new. */
  before_svg: z.string().nullable(),
  /** Absolute path to the staged-flows SVG; null when the tab was removed. */
  after_svg: z.string().nullable(),
  before_png: z.string().nullable(),
  after_png: z.string().nullable(),
});

export const StageRenderSchema = z.object({
  /**
   * Whether `@resvg/resvg-js` imported. False means every `*_png` field is
   * null by construction — install the optional dependency for pixels.
   */
  rasterizer_available: z.boolean(),
  /** One entry per touched tab, staged-flows tab order (prior-only tabs last). */
  tabs: z.array(StageRenderTabSchema),
});

/** Wire shape on stage outputs: the render block, or null when enrichment failed. */
export const StageRenderOutputSchema = StageRenderSchema.nullable();

export type StageRenderTab = z.infer<typeof StageRenderTabSchema>;
export type StageRender = z.infer<typeof StageRenderSchema>;

/**
 * Sidecar recording the last successful stage-render enrichment, keyed by
 * `staged_hash` so `get_staged_change` can re-surface the paths for exactly
 * the pending stage (a stale sidecar can never match a different stage's
 * hash). Lives in RENDER_DIR — deliberately OUTSIDE the staging slot.
 */
const SIDECAR_FILENAME = 'stage-render.json';

const SidecarSchema = z.object({
  staged_hash: z.string(),
  render: StageRenderSchema,
});

/** Path-safe file-name fragment from a Node-RED tab id. */
function sanitizeForFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/** Atomic write: temp file in the destination dir, then rename. */
async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${String(process.pid)}`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, filePath);
}

/**
 * Everything that renders on one tab's canvas: the tab node itself plus all
 * objects parented to it via `z` (nodes, groups, comments, junctions).
 * Including the tab node makes tab creation/removal register as a touch.
 */
function tabSliceHash(flows: FlowsJson, tabId: string): string {
  return canonicalHash(
    flows.filter((n) => (isTab(n) && n.id === tabId) || (n as { z?: string }).z === tabId),
  );
}

/**
 * Tab ids whose canvas content differs between the prior and staged flows,
 * in staged-flows tab order (tabs that only exist in the prior flows last).
 * Changes outside any tab canvas (config nodes, subflow internals) touch no
 * tab and yield an empty list.
 */
function touchedTabIds(prior: FlowsJson, next: FlowsJson): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const flows of [next, prior]) {
    for (const n of flows) {
      if (isTab(n) && !seen.has(n.id)) {
        seen.add(n.id);
        ordered.push(n.id);
      }
    }
  }
  return ordered.filter((id) => tabSliceHash(prior, id) !== tabSliceHash(next, id));
}

interface SideRender {
  svg: string | null;
  png: string | null;
}

async function renderSide(
  flows: FlowsJson,
  tabId: string,
  renderDir: string,
  side: 'before' | 'after',
  rasterizerOk: boolean,
): Promise<SideRender> {
  const present = flows.some((n) => isTab(n) && n.id === tabId);
  if (!present) return { svg: null, png: null };
  const fragment = sanitizeForFilename(tabId);
  const svg = renderSvg(flows, { tabId });
  const svgPath = path.join(renderDir, `stage-${fragment}-${side}.svg`);
  await atomicWrite(svgPath, svg);
  let pngPath: string | null = null;
  if (rasterizerOk) {
    try {
      const { png } = await rasterizeSvg(svg);
      pngPath = path.join(renderDir, `stage-${fragment}-${side}.png`);
      await atomicWrite(pngPath, png);
    } catch {
      // PNG rasterization failed for this SVG (or the rasterizer vanished
      // between the availability probe and the call). The null field plus
      // `rasterizer_available` keep the absence loud; the SVG path stands.
      pngPath = null;
    }
  }
  return { svg: svgPath, png: pngPath };
}

/**
 * Build the `render` block for a stage output. Returns null on ANY failure —
 * render problems must never fail the stage (the staged change is already
 * written when this runs).
 */
export async function buildStageRenderEnrichment(
  ctx: ToolContext,
  priorFlows: FlowsJson,
  stagedFlows: FlowsJson,
  stagedHash: string,
): Promise<StageRender | null> {
  try {
    const renderDir = ctx.config.RENDER_DIR;
    const rasterizer_available = await rasterizerAvailable();
    const tabs: StageRenderTab[] = [];
    for (const tabId of touchedTabIds(priorFlows, stagedFlows)) {
      const before = await renderSide(priorFlows, tabId, renderDir, 'before', rasterizer_available);
      const after = await renderSide(stagedFlows, tabId, renderDir, 'after', rasterizer_available);
      tabs.push({
        tab_id: tabId,
        before_svg: before.svg,
        after_svg: after.svg,
        before_png: before.png,
        after_png: after.png,
      });
    }
    const render: StageRender = { rasterizer_available, tabs };
    await atomicWrite(
      path.join(renderDir, SIDECAR_FILENAME),
      JSON.stringify({ staged_hash: stagedHash, render }, null, 2),
    );
    return render;
  } catch (err) {
    ctx.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'stage render enrichment failed; stage output carries render: null (stage itself unaffected)',
    );
    return null;
  }
}

/**
 * Re-surface the render block for the CURRENT staged change (get_staged_change).
 * Returns the sidecar's render only when its `staged_hash` matches the pending
 * stage byte-for-byte; anything else (no sidecar, parse failure, hash
 * mismatch) yields null.
 */
export async function readStageRenderSidecar(
  renderDir: string,
  stagedHash: string,
): Promise<StageRender | null> {
  try {
    const raw = await readFile(path.join(renderDir, SIDECAR_FILENAME), 'utf8');
    const parsed = SidecarSchema.parse(JSON.parse(raw));
    return parsed.staged_hash === stagedHash ? parsed.render : null;
  } catch {
    return null;
  }
}
