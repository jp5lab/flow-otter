import { z } from 'zod';

import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    snapshot_id: z.string().min(1),
    env: z.string().optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const ManifestSchema = z.object({
  id: z.string(),
  env: z.string(),
  createdAt: z.string(),
  sha256: z.string(),
  rev: z.string().nullable(),
  actor: z.string(),
  reason: z.string(),
  tags: z.array(z.string()),
  serverVersion: z.string().optional(),
});

const OutputSchema = z.object({
  manifest: ManifestSchema,
  flows: z.array(z.record(z.unknown())),
});
type Output = z.infer<typeof OutputSchema>;

export const getSnapshotTool: Tool<Input, Output> = {
  name: 'get_snapshot',
  description:
    'Loads the flows and manifest for a snapshot id from the local snapshot store. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      snapshot_id: { type: 'string', minLength: 1 },
      env: { type: 'string' },
    },
    required: ['snapshot_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const refs = await ctx.snapshots.list(input.env !== undefined ? { env: input.env } : {});
    const ref = refs.find((r) => r.id === input.snapshot_id);
    if (!ref) {
      throw new ValidationFailedError(
        `Snapshot '${input.snapshot_id}' not found${input.env !== undefined ? ` in env '${input.env}'` : ''}.`,
        [],
      );
    }
    const payload = await ctx.snapshots.load(ref);
    return {
      manifest: { ...payload.manifest, tags: [...payload.manifest.tags] },
      flows: payload.flows as unknown as Record<string, unknown>[],
    };
  },
};
