import type { Nudge } from '../types.js';

/**
 * Param-vocabulary mapping hint (WSB-6, 2026-06-10 layout-audit fix plan —
 * owns audit ledger item e3#2).
 *
 * move_node historically named its tab parameter `source_tab_id` while every
 * other author tool says `tab_id`; the audit's e3 session watched an agent
 * burn calls rediscovering the outlier. The schema now accepts `tab_id` as
 * the canonical spelling, and this nudge fires when a successful move_node
 * call still used the deprecated alias — steering the agent back to the
 * shared vocabulary at the moment it matters, before v2.0.0 removes the
 * alias.
 */
export const paramVocabularyNudge: Nudge = {
  id: 'param-vocabulary',
  description:
    "Hints the canonical cross-tool parameter spelling when a deprecated alias was used (move_node's source_tab_id → tab_id).",
  applies: (toolName) => toolName === 'move_node',
  check: (_ctx, args) => {
    if (typeof args !== 'object' || args === null) return null;
    const a = args as Record<string, unknown>;
    if (typeof a['source_tab_id'] === 'string' && a['tab_id'] === undefined) {
      return (
        'This call used source_tab_id, a deprecated alias slated for removal in v2.0.0. ' +
        'Every FlowOtter tool names this parameter tab_id, and move_node accepts tab_id too ' +
        '(with optional dest_tab_id for cross-tab moves). Prefer tab_id in future calls.'
      );
    }
    return null;
  },
};
