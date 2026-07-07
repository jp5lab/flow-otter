import { z } from 'zod';

import { canonicalHash } from '../../../shared/hash.js';
import { compile } from '../../../toolkit/authoring/compile.js';
import { decompile } from '../../../toolkit/authoring/decompile.js';
import { diffFlows, summarizeDiff } from '../../../toolkit/diff/semantic.js';
import { lintFlows, type LintOptions } from '../../../toolkit/lint/flows-lint.js';
import { runValidators, type ValidateOptions } from '../../../toolkit/validate/index.js';
import { enforceMaxFlowSize, enforceNodeTypePolicy } from '../../policy/flow-policy.js';
import type { Tool } from '../_tool.js';
import { runtimeCapabilitiesForTool } from '../_runtime-options.js';

import {
  DiagnosticSchema,
  DiffSummarySchema,
  LayoutHintsSchema,
  LayoutReportSchema,
  SpecSchema,
  layoutHintsJsonSchema,
  prepareSpecAuthoring,
  specJsonSchema,
} from './spec-common.js';

const InputSchema = z
  .object({
    spec: SpecSchema,
    layout_hints: LayoutHintsSchema.optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  would_stage_hash: z.string(),
  based_on_snapshot_hash: z.string(),
  based_on_rev: z.string().nullable(),
  diff_summary: DiffSummarySchema,
  diagnostics: z.array(DiagnosticSchema),
  has_errors: z.boolean(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  layout_report: LayoutReportSchema,
  staged: z.literal(false),
});
type Output = z.infer<typeof OutputSchema>;

export const validateSpecTool: Tool<Input, Output> = {
  name: 'validate_spec',
  description:
    'Read-only diagnostics for a declarative geometry-free AuthoringSpec. It applies the same compile, validation, lint, diff, and two-level computed-placement path as stage_spec but never writes the staging slot, never requires deploy consent, and does not refuse because a staged change is already pending. Declared tabs are authoritative replacements; omitted tabs are preserved. Comment specs may set headerFor to the target group key so layout places the comment as a group header. Raw x/y/position/w/h geometry is refused because FlowOtter computes placement.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['spec'],
    properties: {
      spec: specJsonSchema,
      layout_hints: layoutHintsJsonSchema,
    },
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows: priorFlows, rev: priorRev } = await ctx.flowSource.load();
    const priorHash = canonicalHash(priorFlows);
    const prepared = await prepareSpecAuthoring(
      input.spec,
      decompile(priorFlows),
      priorFlows,
      input.layout_hints,
    );
    const compiled = compile(prepared.spec, { prior: priorFlows });
    enforceMaxFlowSize(compiled.flows, ctx.config.MAX_FLOW_SIZE_BYTES);
    enforceNodeTypePolicy(
      compiled.flows,
      ctx.config.ALLOWED_NODE_TYPES,
      ctx.config.BLOCKED_NODE_TYPES,
    );

    const runtime = await runtimeCapabilitiesForTool(ctx);
    const validateOpts: ValidateOptions = {
      labelCap: ctx.config.LABEL_CAP_CHARS,
    };
    if (ctx.namingContract !== undefined) validateOpts.namingContract = ctx.namingContract;
    if (runtime !== undefined) validateOpts.runtime = runtime;
    const lintOpts: LintOptions = {
      labelCap: ctx.config.LABEL_CAP_CHARS,
      canvasMaxX: ctx.config.CANVAS_MAX_X,
      canvasMaxY: ctx.config.CANVAS_MAX_Y,
      lintViewportWindowWidth: ctx.config.LINT_VIEWPORT_WINDOW_WIDTH,
      layout: true,
    };
    if (ctx.namingContract !== undefined) lintOpts.namingContract = ctx.namingContract;
    if (runtime !== undefined) lintOpts.runtime = runtime;
    const validateReport = runValidators(compiled.flows, validateOpts);
    const lintReport = lintFlows(compiled.flows, lintOpts);

    const seenDiagnostics = new Set<string>();
    const diagnostics = [
      ...compiled.diagnostics.map((d) => ({
        severity: d.severity,
        rule: d.rule,
        message: d.message,
        ...(d.nodeKey !== undefined ? { nodeId: d.nodeKey } : {}),
        ...(d.tabId !== undefined ? { tabId: d.tabId } : {}),
        ...(d.context !== undefined ? { context: d.context } : {}),
      })),
      ...validateReport.diagnostics,
      ...lintReport.diagnostics,
    ].filter((d) => {
      const key = `${d.severity}|${d.rule}|${d.nodeId ?? ''}|${d.tabId ?? ''}|${d.message}`;
      if (seenDiagnostics.has(key)) return false;
      seenDiagnostics.add(key);
      return true;
    });
    const diffSummary = summarizeDiff(diffFlows(priorFlows, compiled.flows));

    return {
      ok: true,
      would_stage_hash: compiled.hash,
      based_on_snapshot_hash: priorHash,
      based_on_rev: priorRev,
      diff_summary: {
        nodes_added: diffSummary.nodes_added,
        nodes_removed: diffSummary.nodes_removed,
        nodes_modified: diffSummary.nodes_modified,
        wires_added: diffSummary.wires_added,
        wires_removed: diffSummary.wires_removed,
      },
      diagnostics: diagnostics.map((d) => ({
        severity: d.severity,
        rule: d.rule,
        message: d.message,
        ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
        ...(d.tabId !== undefined ? { tabId: d.tabId } : {}),
        ...(d.context !== undefined ? { context: d.context } : {}),
      })),
      has_errors: lintReport.hasErrors,
      errors: lintReport.errors.length,
      warnings: lintReport.warnings.length,
      layout_report: prepared.layoutReport,
      staged: false,
    };
  },
};
