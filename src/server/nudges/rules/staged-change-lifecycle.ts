import type { Nudge } from '../types.js';

function outputStagedHash(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null;
  const stagedHash = (result as Record<string, unknown>)['staged_hash'];
  return typeof stagedHash === 'string' ? stagedHash : null;
}

export const stagedChangeLifecycleNudge: Nudge = {
  id: 'staged-change-lifecycle',
  description:
    'Reminds agents that a successful author stage occupies the single staging slot until deployed or discarded.',
  applies: (_toolName, tier) => tier === 'author',
  check: (ctx, _args, result) => {
    const stagedHash = outputStagedHash(result);
    if (stagedHash === null) return null;
    if (ctx.staging.staged_hash !== stagedHash) return null;
    return 'The staging slot now holds this change; to refine it, call discard_staged_change then re-stage; to commit it, call deploy_staged_change (needs confirm/elicitation).';
  },
};
