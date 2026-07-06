import { z } from 'zod';

import { isTab } from '../../../shared/flows-json.js';
import { lintFlows, type LintOptions } from '../../../toolkit/lint/flows-lint.js';
import { ValidationFailedError, type Tool } from '../_tool.js';
import { runtimeCapabilitiesForTool } from '../_runtime-options.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
  })
  .strict();
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
  tab_id: z.string(),
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

export const validateFlowTool: Tool<Input, Output> = {
  name: 'validate_flow',
  description:
    'Runs all validation rules against the flows of a single tab and returns the diagnostics. Read-only.',
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
    const tab = flows.find((n) => isTab(n) && n.id === input.tab_id);
    if (!tab) throw new ValidationFailedError(`Tab '${input.tab_id}' not found.`, []);

    const scoped = flows.filter((n) =>
      isTab(n) ? n.id === input.tab_id : (n as { z?: unknown }).z === input.tab_id,
    );
    const validateOpts: LintOptions = {
      labelCap: ctx.config.LABEL_CAP_CHARS,
      canvasMaxX: ctx.config.CANVAS_MAX_X,
      canvasMaxY: ctx.config.CANVAS_MAX_Y,
      lintViewportWindowWidth: ctx.config.LINT_VIEWPORT_WINDOW_WIDTH,
      layout: true,
    };
    if (ctx.namingContract !== undefined) validateOpts.namingContract = ctx.namingContract;
    const runtime = await runtimeCapabilitiesForTool(ctx);
    if (runtime !== undefined) validateOpts.runtime = runtime;
    const report = lintFlows(scoped, validateOpts);
    if (report.layout === undefined) throw new Error('layout lint report missing');
    return {
      rev,
      tab_id: input.tab_id,
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
