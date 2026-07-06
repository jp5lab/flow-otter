import { z } from 'zod';

import { canonicalHash } from '../../../shared/hash.js';
import {
  ApplyOpError,
  applyOps,
  type BatchOp,
} from '../../../toolkit/authoring/operations/batch.js';
import { decompile } from '../../../toolkit/authoring/decompile.js';
import { BatchOpError, type Tool } from '../_tool.js';

import {
  compileValidateAndStage,
  guardPendingStageForAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';
import { StageChangesOpSchema, stageChangesOpJsonSchema } from './op-schemas.js';

const InputSchema = z
  .object({
    ops: z.array(StageChangesOpSchema).min(1).max(200),
    reason: z.string().min(1).optional(),
    dry_run: z.boolean().optional(),
    amend_of: z.string().min(1).optional(),
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
  ok: z.boolean(),
  staged_hash: z.string(),
  based_on_snapshot_hash: z.string(),
  based_on_rev: z.string().nullable(),
  diff_summary: z.object({
    nodes_added: z.number(),
    nodes_removed: z.number(),
    nodes_modified: z.number(),
    wires_added: z.number(),
    wires_removed: z.number(),
  }),
  op_results: z.array(z.record(z.unknown())),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
  dry_run: z.boolean(),
  staged: z.boolean(),
  amended: z.boolean(),
});
type Output = z.infer<typeof OutputSchema>;

export const stageChangesTool: Tool<Input, Output> = {
  name: 'stage_changes',
  description: withStagedAuthorToolDescription(
    'Stages an atomic ordered batch of authoring ops (1..200) as ONE staged change: add/update/move/remove nodes, junctions, groups, comments, wires, and links. References resolve against earlier ops in the same batch before falling back to current runtime ids. Pass amend_of with the exact pending staged_hash to replace that pending batch during an iterate loop. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['ops'],
    properties: {
      ops: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: stageChangesOpJsonSchema,
      },
      reason: { type: 'string', minLength: 1 },
      dry_run: {
        type: 'boolean',
        description: 'Validate/diff the batch but do not write the staging slot.',
      },
      amend_of: {
        type: 'string',
        minLength: 1,
        description:
          'Exact staged_hash of the current pending stage. When it matches, stage_changes replaces that pending stage; when absent or mismatched, the normal pending-stage refusal applies.',
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
        toolName: 'stage_changes',
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.amend_of !== undefined ? { amendOf: input.amend_of } : {}),
      },
      priorHash,
    );

    const priorSpec = decompile(priorFlows);
    let applied: ReturnType<typeof applyOps>;
    try {
      applied = applyOps(priorSpec, priorFlows, input.ops as readonly BatchOp[]);
    } catch (err) {
      if (err instanceof ApplyOpError) {
        throw new BatchOpError(
          err.message,
          err.failedOpIndex,
          err.failedOp,
          diagnosticsFromCause(err.cause),
        );
      }
      throw err;
    }

    const base = await compileValidateAndStage(
      ctx,
      { flows: priorFlows, hash: priorHash, rev: priorRev },
      applied.spec,
      {
        toolName: 'stage_changes',
        reason: input.reason ?? 'stage_changes',
        idTombstones: applied.idTombstones,
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
      op_results: [...applied.opResults],
      diagnostics: [...base.diagnostics],
      render: base.render,
      dry_run: input.dry_run === true,
      staged: input.dry_run !== true,
      amended: guard.amended,
    };
  },
};

function diagnosticsFromCause(cause: unknown): readonly unknown[] {
  if (typeof cause !== 'object' || cause === null) return [];
  const diagnostics = (cause as { diagnostics?: unknown }).diagnostics;
  return Array.isArray(diagnostics) ? diagnostics : [];
}
