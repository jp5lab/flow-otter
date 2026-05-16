import { z } from 'zod';

import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    node_id: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  node: z.record(z.unknown()),
  tab_id: z.string().nullable(),
  group_id: z.string().nullable(),
});
type Output = z.infer<typeof OutputSchema>;

export const getNodeTool: Tool<Input, Output> = {
  name: 'get_node',
  description: 'Returns a single node by id with its tab and group context. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: { node_id: { type: 'string', minLength: 1 } },
    required: ['node_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows, rev } = await ctx.flowSource.load();
    const node = flows.find((n) => n.id === input.node_id);
    if (!node) throw new ValidationFailedError(`Node '${input.node_id}' not found.`, []);
    const z = (node as { z?: unknown }).z;
    const g = (node as { g?: unknown }).g;
    return {
      rev,
      node: node as unknown as Record<string, unknown>,
      tab_id: typeof z === 'string' ? z : null,
      group_id: typeof g === 'string' ? g : null,
    };
  },
};
