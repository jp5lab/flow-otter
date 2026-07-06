import { describe, expect, it, beforeEach } from 'vitest';

import type { Container } from '../../../../src/server/container.js';
import { buildNudgeRegistry, evaluateNudges } from '../../../../src/server/nudges/registry.js';
import {
  layoutScoresNudge,
  resetLayoutScoresNudgeCacheForTests,
} from '../../../../src/server/nudges/rules/layout-scores.js';
import type { Nudge, NudgeContext } from '../../../../src/server/nudges/types.js';
import { createLogger } from '../../../../src/shared/logger.js';

const STAGED_HASH = 'abc123';

function ctx(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    tool_name: 'add_node',
    tier: 'author',
    staging: {
      node_count: 4,
      has_plan: false,
      staged_hash: STAGED_HASH,
      layout: {
        overall: 0.81,
        rules: [
          {
            rule: 'layout-backward-wires',
            score: 0.25,
            weight: 3,
            offender_count: 3,
            offenders: [],
          },
          {
            rule: 'layout-wire-crossings',
            score: 0.5,
            weight: 3,
            offender_count: 2,
            offenders: [],
          },
        ],
      },
    },
    flow: { has_dashboard_v1: false, has_dashboard_v2: false },
    ...overrides,
  };
}

describe('layout-scores nudge', () => {
  beforeEach(() => {
    resetLayoutScoresNudgeCacheForTests();
  });

  it('applies to author tools except plan_flow', () => {
    expect(layoutScoresNudge.applies('add_node', 'author')).toBe(true);
    expect(layoutScoresNudge.applies('stage_changes', 'author')).toBe(true);
    expect(layoutScoresNudge.applies('plan_flow', 'author')).toBe(false);
    expect(layoutScoresNudge.applies('validate_flow', 'read')).toBe(false);
  });

  it('fires once per staged_hash under the score threshold', () => {
    const result = { staged_hash: STAGED_HASH };
    const first = layoutScoresNudge.check(ctx(), {}, result);
    const second = layoutScoresNudge.check(ctx(), {}, result);
    const nextHash = layoutScoresNudge.check(
      ctx({ staging: { ...ctx().staging, staged_hash: 'def456' } }),
      {},
      { staged_hash: 'def456' },
    );

    expect(first).toContain('Layout score 0.81');
    expect(first).toContain('layout-backward-wires');
    expect(`[layout-scores] ${first}`.length).toBeLessThanOrEqual(300);
    expect(second).toBeNull();
    expect(nextHash).not.toBeNull();
  });

  it('stays silent at 0.95 or above', () => {
    expect(
      layoutScoresNudge.check(
        ctx({ staging: { ...ctx().staging, layout: { overall: 0.95, rules: [] } } }),
        {},
        { staged_hash: STAGED_HASH },
      ),
    ).toBeNull();
  });

  it('is defensive about missing or mismatched stage data', () => {
    expect(layoutScoresNudge.check(ctx(), {}, null)).toBeNull();
    expect(layoutScoresNudge.check(ctx(), {}, { staged_hash: 'other' })).toBeNull();
    expect(
      layoutScoresNudge.check(
        ctx({ staging: { node_count: 0, has_plan: false, staged_hash: STAGED_HASH } }),
        {},
        { staged_hash: STAGED_HASH },
      ),
    ).toBeNull();
  });

  it('is registered in the nudge registry', () => {
    const nudges = buildNudgeRegistry({} as unknown as Container);
    expect(nudges.map((n) => n.id)).toContain('layout-scores');
  });

  it('nudge failures are skipped by the evaluator', () => {
    const throwing: Nudge = {
      ...layoutScoresNudge,
      check: () => {
        throw new Error('boom');
      },
    };
    const messages = evaluateNudges(
      [throwing],
      ctx(),
      {},
      { staged_hash: STAGED_HASH },
      createLogger({ level: 'silent' }),
    );

    expect(messages).toEqual([]);
  });
});
