import { z } from 'zod';

import { analyzeFlow } from '../../../toolkit/analyze/structural.js';
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

export const analyzeFlowTool: Tool<Input, Output> = {
  name: 'analyze_flow',
  description:
    'Returns a structural report (counts, type histogram, link summary, dashboard widget count, orphans, validation report) for one tab. Read-only.',
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
    const report = analyzeFlow(flows, input.tab_id, {
      labelCap: ctx.config.LABEL_CAP_CHARS,
      ...(ctx.namingContract !== undefined ? { namingContract: ctx.namingContract } : {}),
    });
    return { rev, report: report as unknown as Record<string, unknown> };
  },
};
