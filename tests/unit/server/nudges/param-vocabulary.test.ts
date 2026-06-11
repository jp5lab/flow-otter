import { describe, expect, it } from 'vitest';

import type { Container } from '../../../../src/server/container.js';
import { buildNudgeRegistry } from '../../../../src/server/nudges/registry.js';
import { paramVocabularyNudge } from '../../../../src/server/nudges/rules/param-vocabulary.js';
import type { NudgeContext } from '../../../../src/server/nudges/types.js';

function ctx(toolName = 'move_node'): NudgeContext {
  return {
    tool_name: toolName,
    tier: 'author',
    staging: { node_count: 0, has_plan: false },
    flow: { has_dashboard_v1: false, has_dashboard_v2: false },
  };
}

describe('param-vocabulary nudge (WSB-6, e3#2)', () => {
  it('applies to move_node only', () => {
    expect(paramVocabularyNudge.applies('move_node', 'author')).toBe(true);
    expect(paramVocabularyNudge.applies('add_node', 'author')).toBe(false);
    expect(paramVocabularyNudge.applies('update_node', 'author')).toBe(false);
    expect(paramVocabularyNudge.applies('get_staged_change', 'read')).toBe(false);
  });

  it('fires when the deprecated source_tab_id alias was used without tab_id', () => {
    const msg = paramVocabularyNudge.check(ctx(), { source_tab_id: 'tab1', node_key: 'n1' }, null);
    expect(msg).not.toBeNull();
    expect(msg).toContain('tab_id');
    expect(msg).toContain('source_tab_id');
    expect(msg).toContain('v2.0.0');
  });

  it('stays silent when the canonical tab_id was used', () => {
    expect(paramVocabularyNudge.check(ctx(), { tab_id: 'tab1', node_key: 'n1' }, null)).toBeNull();
  });

  it('stays silent when both spellings were supplied (caller already knows tab_id)', () => {
    expect(
      paramVocabularyNudge.check(
        ctx(),
        { tab_id: 'tab1', source_tab_id: 'tab1', node_key: 'n1' },
        null,
      ),
    ).toBeNull();
  });

  it('is defensive about non-object args', () => {
    expect(paramVocabularyNudge.check(ctx(), null, null)).toBeNull();
    expect(paramVocabularyNudge.check(ctx(), 'source_tab_id', null)).toBeNull();
  });

  it('is registered in the nudge registry', () => {
    const nudges = buildNudgeRegistry({} as unknown as Container);
    expect(nudges.map((n) => n.id)).toContain('param-vocabulary');
  });
});
