import { z } from 'zod';

import { lintFlows } from '../../../toolkit/lint/flows-lint.js';
import type { NamingContract } from '../../../toolkit/naming/schema.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const DiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  rule: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  tabId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

const OutputSchema = z.object({
  rev: z.string().nullable(),
  diagnostics: z.array(DiagnosticSchema),
  has_errors: z.boolean(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  layout: z.object({
    overall: z.number(),
    rules: z.array(
      z.object({
        rule: z.string(),
        score: z.number(),
        weight: z.number(),
        offender_count: z.number().int().nonnegative(),
        offenders: z.array(z.record(z.unknown())),
      }),
    ),
  }),
});
type Output = z.infer<typeof OutputSchema>;

export const validateAllFlowsTool: Tool<Input, Output> = {
  name: 'validate_all_flows',
  description: 'Runs all validation rules over the entire flows document. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    const { flows, rev } = await ctx.flowSource.load();
    const validateOpts: {
      labelCap: number;
      canvasMaxX: number;
      canvasMaxY: number;
      lintViewportWindowWidth: number;
      layout: true;
      namingContract?: NamingContract;
    } = {
      labelCap: ctx.config.LABEL_CAP_CHARS,
      canvasMaxX: ctx.config.CANVAS_MAX_X,
      canvasMaxY: ctx.config.CANVAS_MAX_Y,
      lintViewportWindowWidth: ctx.config.LINT_VIEWPORT_WINDOW_WIDTH,
      layout: true,
    };
    if (ctx.namingContract !== undefined) validateOpts.namingContract = ctx.namingContract;
    const report = lintFlows(flows, validateOpts);
    if (report.layout === undefined) throw new Error('layout lint report missing');
    return {
      rev,
      diagnostics: report.diagnostics.map((d) => ({
        severity: d.severity,
        rule: d.rule,
        message: d.message,
        ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
        ...(d.tabId !== undefined ? { tabId: d.tabId } : {}),
        ...(d.context !== undefined ? { context: d.context } : {}),
      })),
      has_errors: report.hasErrors,
      errors: report.errors.length,
      warnings: report.warnings.length,
      layout: report.layout,
    };
  },
};
