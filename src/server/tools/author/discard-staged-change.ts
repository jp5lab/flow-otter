import { z } from 'zod';

import { type Tool, ValidationFailedError } from '../_tool.js';

const InputSchema = z
  .object({
    /**
     * Optional safety assertion: only discard if the pending stage has this
     * hash. Prevents discarding a stage you haven't looked at.
     */
    staged_hash: z.string().min(1).optional(),
    /**
     * Discard a stage authored by a different agent process. Default false;
     * mirrors deploy_staged_change's takeover guard.
     */
    force_takeover: z.boolean().optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  /** False when there was nothing to discard. */
  discarded: z.boolean(),
  staged_hash: z.string().nullable(),
  reason: z.string().nullable(),
});
type Output = z.infer<typeof OutputSchema>;

export const discardStagedChangeTool: Tool<Input, Output> = {
  name: 'discard_staged_change',
  description:
    'Discards the pending staged change without deploying it. Use after deciding against a staged op, or to clear a stale stage blocking new author calls (author tools refuse to stage over an undeployed change). Pass staged_hash to assert which stage you are discarding. Does not touch the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      staged_hash: {
        type: 'string',
        minLength: 1,
        description: 'Only discard if the pending stage has this hash.',
      },
      force_takeover: {
        type: 'boolean',
        description: 'Discard a stage authored by a different agent process. Default false.',
      },
    },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const staged = await ctx.staging.read();
    if (staged === null) {
      return { ok: true, discarded: false, staged_hash: null, reason: null };
    }
    if (input.staged_hash !== undefined && staged.stagedHash !== input.staged_hash) {
      throw new ValidationFailedError(
        `Staged hash mismatch: requested '${input.staged_hash}', pending stage is '${staged.stagedHash}'. Call get_staged_change to inspect it first.`,
        [],
      );
    }
    const stagedAgentId = staged.agent_id;
    if (
      stagedAgentId !== undefined &&
      stagedAgentId !== ctx.agentId &&
      input.force_takeover !== true
    ) {
      throw new ValidationFailedError(
        `Staged change was authored by a different agent process (staged.agent_id='${stagedAgentId}', current='${ctx.agentId}'). Pass force_takeover:true to discard it anyway.`,
        [],
      );
    }
    await ctx.staging.clear();
    ctx.enrichAudit({ mode: 'stage', result: 'warning' });
    return {
      ok: true,
      discarded: true,
      staged_hash: staged.stagedHash,
      reason: staged.reason,
    };
  },
};
