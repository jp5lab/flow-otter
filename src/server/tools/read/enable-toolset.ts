import { z } from 'zod';

import { TOOLSETS, type ToolsetName } from '../toolsets.js';
import type { Tool } from '../_tool.js';

const TOOLSET_NAMES = Object.keys(TOOLSETS) as readonly ToolsetName[];

const InputSchema = z
  .object({
    name: z.enum(TOOLSET_NAMES as unknown as [ToolsetName, ...ToolsetName[]]),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.literal(true),
  toolset: z.string(),
  already_enabled: z.boolean(),
  added: z.array(z.string()),
});
type Output = z.infer<typeof OutputSchema>;

export const enableToolsetTool: Tool<Input, Output> = {
  name: 'enable_toolset',
  description:
    'Enable a non-default toolset for this session. Tools belonging to the toolset become visible and callable. Read-tier from a side-effect perspective: only mutates in-memory registry state, no flows/staging changes. Call list_available_toolsets first to see what is available.',
  tier: 'read',
  annotations: {
    readOnlyHint: false,
    idempotentHint: true,
    destructiveHint: false,
  },
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        enum: [...TOOLSET_NAMES],
        description: 'Name of the toolset to enable.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) => {
    const registry = ctx.container.toolRegistry;
    if (registry === undefined) {
      throw new Error(
        'Tool registry not attached to container; enable_toolset cannot mutate registry state.',
      );
    }
    const result = registry.enableToolset(input.name);
    return Promise.resolve({
      ok: true as const,
      toolset: input.name,
      already_enabled: result.already_enabled,
      added: [...result.added],
    });
  },
};
