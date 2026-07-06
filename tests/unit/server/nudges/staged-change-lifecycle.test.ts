import { describe, expect, it } from 'vitest';

import type { Container } from '../../../../src/server/container.js';
import { buildNudgeRegistry } from '../../../../src/server/nudges/registry.js';
import { stagedChangeLifecycleNudge } from '../../../../src/server/nudges/rules/staged-change-lifecycle.js';
import type { NudgeContext } from '../../../../src/server/nudges/types.js';

const STAGED_HASH = 'abc123';

function ctx(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    tool_name: 'add_comment',
    tier: 'author',
    staging: { node_count: 2, has_plan: false, staged_hash: STAGED_HASH },
    flow: { has_dashboard_v1: false, has_dashboard_v2: false },
    ...overrides,
  };
}

describe('staged-change-lifecycle nudge', () => {
  it('applies to author tools only', () => {
    expect(stagedChangeLifecycleNudge.applies('add_comment', 'author')).toBe(true);
    expect(stagedChangeLifecycleNudge.applies('move_node', 'author')).toBe(true);
    expect(stagedChangeLifecycleNudge.applies('get_staged_change', 'read')).toBe(false);
    expect(stagedChangeLifecycleNudge.applies('deploy_staged_change', 'deploy')).toBe(false);
  });

  it('fires when an author response leaves a matching pending staged change', () => {
    const msg = stagedChangeLifecycleNudge.check(ctx(), {}, { ok: true, staged_hash: STAGED_HASH });
    expect(msg).toBe(
      'The staging slot now holds this change; to refine it, call discard_staged_change then re-stage; to commit it, call deploy_staged_change (needs confirm/elicitation).',
    );
  });

  it('stays silent without a matching pending staged change', () => {
    expect(stagedChangeLifecycleNudge.check(ctx(), {}, { ok: true })).toBeNull();
    expect(
      stagedChangeLifecycleNudge.check(ctx(), {}, { ok: true, staged_hash: 'different' }),
    ).toBeNull();
    expect(
      stagedChangeLifecycleNudge.check(
        ctx({ staging: { node_count: 0, has_plan: false } }),
        {},
        { ok: true, staged_hash: STAGED_HASH },
      ),
    ).toBeNull();
  });

  it('is defensive about non-object results', () => {
    expect(stagedChangeLifecycleNudge.check(ctx(), {}, null)).toBeNull();
    expect(stagedChangeLifecycleNudge.check(ctx(), {}, STAGED_HASH)).toBeNull();
  });

  it('is registered in the nudge registry', () => {
    const nudges = buildNudgeRegistry({} as unknown as Container);
    expect(nudges.map((n) => n.id)).toContain('staged-change-lifecycle');
  });
});
