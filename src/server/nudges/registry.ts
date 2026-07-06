/**
 * Soft-nudge registry. Add new rules to the array; the evaluator runs every
 * applicable rule for each tool call and aggregates their messages.
 *
 * Nudges that need access to the container (e.g., session-scoped preview
 * tracker) take a getter at construction time.
 */

import type { Logger } from '../../shared/logger.js';
import type { Container } from '../container.js';

import { makeDeployWithoutPreviewNudge } from './rules/deploy-without-preview.js';
import { layoutScoresNudge } from './rules/layout-scores.js';
import { nodeKeyVocabularyNudge } from './rules/node-key-vocabulary.js';
import { noPlanForLargeFlowNudge } from './rules/no-plan-for-large-flow.js';
import { paramVocabularyNudge } from './rules/param-vocabulary.js';
import { stagedChangeLifecycleNudge } from './rules/staged-change-lifecycle.js';
import type { Nudge, NudgeContext } from './types.js';

export function buildNudgeRegistry(container: Container): readonly Nudge[] {
  return [
    noPlanForLargeFlowNudge,
    makeDeployWithoutPreviewNudge(() => container),
    paramVocabularyNudge,
    nodeKeyVocabularyNudge,
    layoutScoresNudge,
    stagedChangeLifecycleNudge,
  ];
}

/**
 * Evaluate every applicable nudge. Defensive: nudges that throw are logged
 * and skipped — they never break the tool call.
 */
export function evaluateNudges(
  nudges: readonly Nudge[],
  context: NudgeContext,
  args: unknown,
  result: unknown,
  logger: Logger,
): string[] {
  const applicable = nudges.filter((n) => {
    try {
      return n.applies(context.tool_name, context.tier);
    } catch {
      return false;
    }
  });
  const messages: string[] = [];
  for (const n of applicable) {
    try {
      const msg = n.check(context, args, result);
      if (typeof msg === 'string' && msg.length > 0) messages.push(`[${n.id}] ${msg}`);
    } catch (err) {
      logger.warn(
        { nudge: n.id, err: err instanceof Error ? err.message : String(err) },
        'nudge check threw; skipping',
      );
    }
  }
  return messages;
}
