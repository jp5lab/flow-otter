import { z } from 'zod';

import { lintFlows, type LintOptions } from '../../../toolkit/lint/flows-lint.js';
import { ValidationFailedError, type Tool } from '../_tool.js';
import { runtimeCapabilitiesForTool } from '../_runtime-options.js';

import { loadValidationSource, resolveTabNodeRedId } from './_validation-against.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
    against: z.enum(['staged', 'runtime']).optional(),
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
  against: z.enum(['staged', 'runtime']).optional(),
  staged_hash: z.string().nullable().optional(),
  based_on_snapshot_hash: z.string().nullable().optional(),
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
    "Runs all validation rules against a single tab and returns diagnostics plus layout scores. against:'staged' validates the pending staged change; the default ('runtime') validates the deployed runtime flows, which do NOT include pending staged changes. On the staged path, tab_id accepts either the staged tab's _authoringKey or its materialized Node-RED id. Read-only.",
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      against: {
        type: 'string',
        enum: ['staged', 'runtime'],
        description:
          "What to validate: 'staged' = the pending staged change (errors if the staging slot is empty), 'runtime' = the deployed runtime flows (default).",
      },
    },
    required: ['tab_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const includeAgainstMetadata = input.against !== undefined;
    const source = await loadValidationSource(ctx, input.against ?? 'runtime', 'validate_flow');
    const tabId = resolveTabNodeRedId(source.flows, input.tab_id, {
      acceptAuthoringKey: source.against === 'staged',
    });
    if (tabId === undefined) {
      throw new ValidationFailedError(
        `Tab '${input.tab_id}' not found${source.against === 'staged' ? ' in the staged change' : ''}.`,
        [],
      );
    }

    const scoped = source.flows.filter((n) =>
      n.type === 'tab' ? n.id === tabId : (n as { z?: unknown }).z === tabId,
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
    const out = {
      rev: source.rev,
      tab_id: tabId,
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
    if (!includeAgainstMetadata) return out;
    return {
      ...out,
      against: source.against,
      staged_hash: source.stagedHash,
      based_on_snapshot_hash: source.basedOnSnapshotHash,
    };
  },
};
