import { describe, expect, it } from 'vitest';

import {
  clearPreviewTracker,
  makeDeployWithoutPreviewNudge,
  recordPreviewed,
} from '../../../../src/server/nudges/rules/deploy-without-preview.js';
import type { NudgeContext } from '../../../../src/server/nudges/types.js';

function ctx(stagedHash: string | undefined): NudgeContext {
  return {
    tool_name: 'deploy_staged_change',
    tier: 'deploy',
    staging: {
      node_count: 20,
      has_plan: true,
      ...(stagedHash !== undefined ? { staged_hash: stagedHash } : {}),
    },
    flow: { has_dashboard_v1: false, has_dashboard_v2: false },
  };
}

describe('deploy-without-preview nudge', () => {
  it('only applies to deploy_staged_change', () => {
    const container = {};
    const nudge = makeDeployWithoutPreviewNudge(() => container);
    expect(nudge.applies('deploy_staged_change', 'deploy')).toBe(true);
    expect(nudge.applies('add_node', 'author')).toBe(false);
  });

  it('does not fire when no staged_hash is present (no stage to preview)', () => {
    const container = {};
    const nudge = makeDeployWithoutPreviewNudge(() => container);
    expect(nudge.check(ctx(undefined), null, null)).toBeNull();
  });

  it('fires when staged_hash present and not in tracker', () => {
    const container = {};
    const nudge = makeDeployWithoutPreviewNudge(() => container);
    expect(nudge.check(ctx('hash-abc'), null, null)).toContain('preview_flow_diff was not called');
  });

  it('stays silent when staged_hash present and in tracker', () => {
    const container = {};
    recordPreviewed(container, 'hash-abc');
    const nudge = makeDeployWithoutPreviewNudge(() => container);
    expect(nudge.check(ctx('hash-abc'), null, null)).toBeNull();
  });

  it('clearPreviewTracker wipes recorded hashes', () => {
    const container = {};
    recordPreviewed(container, 'hash-abc');
    clearPreviewTracker(container);
    const nudge = makeDeployWithoutPreviewNudge(() => container);
    expect(nudge.check(ctx('hash-abc'), null, null)).toContain('not called');
  });
});
