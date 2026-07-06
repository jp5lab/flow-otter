import { z } from 'zod';

import { analyzeAllFlows } from '../../../toolkit/analyze/structural.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  report: z.record(z.unknown()),
});
type Output = z.infer<typeof OutputSchema>;

export const analyzeAllFlowsTool: Tool<Input, Output> = {
  name: 'analyze_all_flows',
  description:
    'Aggregates structural reports across every tab plus cross-tab totals and a global validation report. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    const { flows, rev } = await ctx.flowSource.load();
    const report = analyzeAllFlows(flows, {
      labelCap: ctx.config.LABEL_CAP_CHARS,
      canvasMaxX: ctx.config.CANVAS_MAX_X,
      canvasMaxY: ctx.config.CANVAS_MAX_Y,
      lintViewportWindowWidth: ctx.config.LINT_VIEWPORT_WINDOW_WIDTH,
      ...(ctx.namingContract !== undefined ? { namingContract: ctx.namingContract } : {}),
    });
    return { rev, report: report as unknown as Record<string, unknown> };
  },
};
