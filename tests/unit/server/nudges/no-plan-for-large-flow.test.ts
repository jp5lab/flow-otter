import { describe, expect, it } from 'vitest';

import { noPlanForLargeFlowNudge } from '../../../../src/server/nudges/rules/no-plan-for-large-flow.js';
import type { NudgeContext } from '../../../../src/server/nudges/types.js';

function ctx(overrides: Partial<NudgeContext['staging']> = {}): NudgeContext {
  return {
    tool_name: 'add_node',
    tier: 'author',
    staging: {
      node_count: 0,
      has_plan: false,
      ...overrides,
    },
    flow: {
      has_dashboard_v1: false,
      has_dashboard_v2: false,
    },
  };
}

describe('no-plan-for-large-flow nudge', () => {
  it('does not fire on a small flow without plan', () => {
    expect(noPlanForLargeFlowNudge.check(ctx({ node_count: 5 }), null, null)).toBeNull();
  });

  it('does not fire when a plan exists, even for large flows', () => {
    expect(
      noPlanForLargeFlowNudge.check(
        ctx({ node_count: 50, has_plan: true, plan_id: 'p1' }),
        null,
        null,
      ),
    ).toBeNull();
  });

  it('fires on a large flow without a plan', () => {
    const msg = noPlanForLargeFlowNudge.check(ctx({ node_count: 12 }), null, null);
    expect(msg).toContain('No plan_flow record');
    expect(msg).toContain('12 nodes');
  });

  it('fires right at the threshold (10 nodes)', () => {
    expect(noPlanForLargeFlowNudge.check(ctx({ node_count: 10 }), null, null)).toContain(
      'No plan_flow record',
    );
  });

  it('applies to add_node and many specialist tools, not to read tools', () => {
    expect(noPlanForLargeFlowNudge.applies('add_node', 'author')).toBe(true);
    expect(noPlanForLargeFlowNudge.applies('add_function_node', 'author')).toBe(true);
    expect(noPlanForLargeFlowNudge.applies('add_dashboard_widget', 'author')).toBe(true);
    expect(noPlanForLargeFlowNudge.applies('wire_nodes', 'author')).toBe(true);
    expect(noPlanForLargeFlowNudge.applies('get_flow', 'read')).toBe(false);
    expect(noPlanForLargeFlowNudge.applies('plan_flow', 'author')).toBe(false);
    expect(noPlanForLargeFlowNudge.applies('deploy_staged_change', 'deploy')).toBe(false);
  });
});
