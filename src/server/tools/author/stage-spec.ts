import { z } from 'zod';

import { canonicalHash } from '../../../shared/hash.js';
import { decompile } from '../../../toolkit/authoring/decompile.js';
import type { Tool } from '../_tool.js';

import {
  compileValidateAndStage,
  guardPendingStageForAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';
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
    reason: z.string().min(1).optional(),
    dry_run: z.boolean().optional(),
    amend_of: z.string().min(1).optional(),
    force_takeover: z.boolean().optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  staged_hash: z.string(),
  based_on_snapshot_hash: z.string(),
  based_on_rev: z.string().nullable(),
  diff_summary: DiffSummarySchema,
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
  layout_report: LayoutReportSchema,
  dry_run: z.boolean(),
  staged: z.boolean(),
  amended: z.boolean(),
});
type Output = z.infer<typeof OutputSchema>;

export const stageSpecTool: Tool<Input, Output> = {
  name: 'stage_spec',
  description: withStagedAuthorToolDescription(
    'Stages a declarative geometry-free AuthoringSpec as ONE staged change. Declared tabs are authoritative whole-tab replacements; tabs omitted from spec.tabs are preserved. configNodes and subflowDefs are preserved when omitted and replaced wholesale when supplied. Existing objects with matching _authoringKey/id preserve Node-RED ids and pinned geometry; FlowOtter computes all placement with the two-level layout engine. Comment specs may set headerFor to the target group key so layout places the comment as a group header. Use layout_hints for lane_hints and section_order; raw x/y/position/w/h geometry is refused. dry_run validates/diffs/reports without writing the staging slot. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['spec'],
    properties: {
      spec: specJsonSchema,
      layout_hints: layoutHintsJsonSchema,
      reason: { type: 'string', minLength: 1 },
      dry_run: {
        type: 'boolean',
        description: 'Validate/diff/report but do not write the staging slot.',
      },
      amend_of: {
        type: 'string',
        minLength: 1,
        description:
          'Exact staged_hash of the current pending stage. When it matches, stage_spec replaces that pending stage; when absent or mismatched, the normal pending-stage refusal applies.',
      },
      force_takeover: {
        type: 'boolean',
        description:
          'Amend a stage authored by a different agent process. Default false; only applies with amend_of.',
      },
    },
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows: priorFlows, rev: priorRev } = await ctx.flowSource.load();
    const priorHash = canonicalHash(priorFlows);
    const guard = await guardPendingStageForAuthorOp(
      ctx,
      {
        toolName: 'stage_spec',
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.amend_of !== undefined ? { amendOf: input.amend_of } : {}),
        ...(input.force_takeover !== undefined ? { forceTakeover: input.force_takeover } : {}),
      },
      priorHash,
    );

    const prepared = await prepareSpecAuthoring(
      input.spec,
      decompile(priorFlows),
      priorFlows,
      input.layout_hints,
    );
    const base = await compileValidateAndStage(
      ctx,
      { flows: priorFlows, hash: priorHash, rev: priorRev },
      prepared.spec,
      {
        toolName: 'stage_spec',
        reason: input.reason ?? 'stage_spec',
        dryRun: input.dry_run === true,
        ...(guard.autoClearDiagnostic !== undefined
          ? { autoClearDiagnostic: guard.autoClearDiagnostic }
          : {}),
      },
    );

    return {
      ok: base.ok,
      staged_hash: base.staged_hash,
      based_on_snapshot_hash: base.based_on_snapshot_hash,
      based_on_rev: base.based_on_rev,
      diff_summary: base.diff_summary,
      diagnostics: [...base.diagnostics],
      render: base.render,
      layout_report: prepared.layoutReport,
      dry_run: input.dry_run === true,
      staged: input.dry_run !== true,
      amended: guard.amended,
    };
  },
};
