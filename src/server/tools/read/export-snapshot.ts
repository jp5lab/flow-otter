import { z } from 'zod';

import type { Tool } from '../_tool.js';

const InputSchema = z
  .object({
    reason: z.string().min(1).optional(),
    tags: z.array(z.string()).max(16).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ref: z.object({
    id: z.string(),
    env: z.string(),
    createdAt: z.string(),
    sha256: z.string(),
    rev: z.string().nullable(),
    tags: z.array(z.string()),
  }),
});
type Output = z.infer<typeof OutputSchema>;

export const exportSnapshotTool: Tool<Input, Output> = {
  name: 'export_snapshot',
  description:
    'Captures the current runtime flows as a snapshot in the local snapshot store and returns the snapshot ref. Read-only at the runtime layer (does not modify Node-RED) but writes to the local snapshot directory.',
  tier: 'read',
  // Read-tier defaults set readOnlyHint: true, but export_snapshot writes
  // a snapshot file. Override hints to accurately surface the side effect.
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: false,
  },
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', minLength: 1 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows, rev } = await ctx.flowSource.load();
    const takenAt = ctx.clock().toISOString();
    const ref = await ctx.snapshots.save({
      flows,
      rev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: input.reason ?? 'export_snapshot',
      takenAt,
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      serverVersion: ctx.serverVersion,
    });
    return { ref: { ...ref, tags: [...ref.tags] } };
  },
};
