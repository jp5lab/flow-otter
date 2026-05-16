import { z } from 'zod';

import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  staged: z
    .object({
      stagedHash: z.string(),
      basedOnSnapshotHash: z.string(),
      basedOnRev: z.string().nullable(),
      stagedAt: z.string(),
      actor: z.string(),
      reason: z.string(),
    })
    .nullable(),
});
type Output = z.infer<typeof OutputSchema>;

export const getStagedChangeTool: Tool<Input, Output> = {
  name: 'get_staged_change',
  description: 'Returns metadata for the current staged change (or null if none). Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    const staged = await ctx.staging.read();
    if (!staged) return { staged: null };
    return {
      staged: {
        stagedHash: staged.stagedHash,
        basedOnSnapshotHash: staged.basedOnSnapshotHash,
        basedOnRev: staged.basedOnRev,
        stagedAt: staged.stagedAt,
        actor: staged.actor,
        reason: staged.reason,
      },
    };
  },
};
