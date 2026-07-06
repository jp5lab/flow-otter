import type { LayoutScoreSummary } from '../../../toolkit/lint/flows-lint.js';
import type { Nudge } from '../types.js';

const SCORE_THRESHOLD = 0.95;
const PREFIX = '[layout-scores] ';
const MAX_MESSAGE_CHARS = 300 - PREFIX.length;

const emittedHashes = new Set<string>();

function outputStagedHash(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null;
  const stagedHash = (result as Record<string, unknown>)['staged_hash'];
  return typeof stagedHash === 'string' ? stagedHash : null;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function weakestRules(layout: LayoutScoreSummary): string[] {
  return [...layout.rules]
    .filter((r) => r.offender_count > 0 || r.score < 1)
    .sort((a, b) => a.score - b.score || b.weight - a.weight || a.rule.localeCompare(b.rule))
    .slice(0, 2)
    .map((r) => `${r.rule} ${formatScore(r.score)}`);
}

function boundedMessage(layout: LayoutScoreSummary): string {
  const score = formatScore(layout.overall);
  const weakest = weakestRules(layout);
  const suffix = weakest.length > 0 ? ` Weakest: ${weakest.join(', ')}.` : '';
  const message = `Layout score ${score}.${suffix} Run validate_flow for per-rule offenders.`;
  if (message.length <= MAX_MESSAGE_CHARS) return message;
  return `Layout score ${score}. Run validate_flow for per-rule layout offenders.`;
}

export function resetLayoutScoresNudgeCacheForTests(): void {
  emittedHashes.clear();
}

export const layoutScoresNudge: Nudge = {
  id: 'layout-scores',
  description:
    'After authoring, nudges agents to inspect validate_flow layout scores when the staged layout score is below the target.',
  applies: (toolName, tier) => tier === 'author' && toolName !== 'plan_flow',
  check: (ctx, _args, result) => {
    const stagedHash = outputStagedHash(result);
    if (stagedHash === null) return null;
    if (ctx.staging.staged_hash !== stagedHash) return null;
    if (emittedHashes.has(stagedHash)) return null;
    const layout = ctx.staging.layout;
    if (layout === undefined) return null;
    if (!Number.isFinite(layout.overall) || layout.overall >= SCORE_THRESHOLD) return null;

    emittedHashes.add(stagedHash);
    return boundedMessage(layout);
  },
};
