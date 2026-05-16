import { z } from 'zod';

import type { Tool } from '../_tool.js';

const InputSchema = z
  .object({
    env: z.string().optional(),
    tag: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const SnapshotRefSchema = z.object({
  id: z.string(),
  env: z.string(),
  createdAt: z.string(),
  sha256: z.string(),
  rev: z.string().nullable(),
  tags: z.array(z.string()),
});

const OutputSchema = z.object({
  snapshots: z.array(SnapshotRefSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const listSnapshotsTool: Tool<Input, Output> = {
  name: 'list_snapshots',
  description:
    'Lists snapshots from the local snapshot store, optionally filtered by env, tag, or limit. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      env: { type: 'string' },
      tag: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
    },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const filter: { env?: string; tag?: string; limit?: number } = {};
    if (input.env !== undefined) filter.env = input.env;
    if (input.tag !== undefined) filter.tag = input.tag;
    if (input.limit !== undefined) filter.limit = input.limit;
    const refs = await ctx.snapshots.list(filter);
    return {
      snapshots: refs.map((r) => ({
        id: r.id,
        env: r.env,
        createdAt: r.createdAt,
        sha256: r.sha256,
        rev: r.rev,
        tags: [...r.tags],
      })),
    };
  },
};
