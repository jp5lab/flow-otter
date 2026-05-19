import type { Nudge } from '../types.js';

/**
 * Fires when `deploy_staged_change` is about to run without preview_flow_diff
 * having been called this session for the current staged_hash. Preview
 * tracking is session-scoped (cleared on container rebind / restart) — not
 * a hard correctness guarantee, but enough to catch the common
 * "agent skipped the preview step" pattern.
 *
 * Preview tracking is wired into preview_flow_diff via the recordPreviewed
 * helper. Reset on set_target.
 */

const PREVIEW_TRACKER_KEY = Symbol.for('flow-otter.preview-tracker');

interface PreviewTrackerSlot {
  [PREVIEW_TRACKER_KEY]?: Set<string>;
}

export function recordPreviewed(container: unknown, stagedHash: string): void {
  const slot = container as PreviewTrackerSlot;
  if (slot[PREVIEW_TRACKER_KEY] === undefined) slot[PREVIEW_TRACKER_KEY] = new Set();
  slot[PREVIEW_TRACKER_KEY].add(stagedHash);
}

export function clearPreviewTracker(container: unknown): void {
  const slot = container as PreviewTrackerSlot;
  delete slot[PREVIEW_TRACKER_KEY];
}

function previewedHashes(container: unknown): ReadonlySet<string> | undefined {
  const slot = container as PreviewTrackerSlot;
  return slot[PREVIEW_TRACKER_KEY];
}

export function makeDeployWithoutPreviewNudge(getContainer: () => unknown): Nudge {
  return {
    id: 'deploy-without-preview',
    description:
      'Reminds the agent to call preview_flow_diff before deploy_staged_change so the user sees the diff and can confirm.',
    applies: (toolName) => toolName === 'deploy_staged_change',
    check: (ctx) => {
      if (ctx.staging.staged_hash === undefined) return null;
      const previewed = previewedHashes(getContainer());
      if (previewed !== undefined && previewed.has(ctx.staging.staged_hash)) return null;
      return `deploy_staged_change is about to run, but preview_flow_diff was not called this session for staged_hash ${ctx.staging.staged_hash}. Call preview_flow_diff first, show the user the diff summary, and elicit confirmation before deploying.`;
    },
  };
}
