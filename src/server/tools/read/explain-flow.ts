import { z } from 'zod';

import { explainFlow } from '../../../toolkit/analyze/explain.js';
import type { Tool } from '../_tool.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  report: z.record(z.unknown()),
});
type Output = z.infer<typeof OutputSchema>;

export const explainFlowTool: Tool<Input, Output> = {
  name: 'explain_flow',
  description:
    'Walks a tab from entrypoints to sinks and returns a human-readable structural narrative with edges, orphans, and notes. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: { tab_id: { type: 'string', minLength: 1 } },
    required: ['tab_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows, rev } = await ctx.flowSource.load();
    const report = explainFlow(flows, input.tab_id);
    return { rev, report: report as unknown as Record<string, unknown> };
  },
};
