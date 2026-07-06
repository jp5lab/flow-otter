import { z } from 'zod';

import { setWires } from '../../../toolkit/authoring/operations/set-wires.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  attachNodeKeyResolutionGuidance,
  resolveNodeKeyOnTab,
  type NodeKeyResolutionGuidance,
} from './_node-key-resolution.js';
import {
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
    source_node_id: z.string().min(1),
    output_port: z.number().int().nonnegative().optional(),
    target_node_ids: z.array(z.string().min(1)),
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
  wires_removed_count: z.number(),
  wires_added_count: z.number(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const setWiresTool: Tool<Input, Output> = {
  name: 'set_wires',
  description: withStagedAuthorToolDescription(
    'Atomically replaces all wires originating from `(source_node_id, output_port)` with new wires to the given target node ids on the same tab. Pass `target_node_ids: []` to clear the port. Cross-tab wiring goes through link nodes — see `set_links`. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      source_node_id: { type: 'string', minLength: 1 },
      output_port: { type: 'integer', minimum: 0 },
      target_node_ids: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['tab_id', 'source_node_id', 'target_node_ids'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<
      { removed: number; added: number; guidance: readonly NodeKeyResolutionGuidance[] },
      Output
    >(
      ctx,
      { toolName: 'set_wires' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const sourceKey = resolveNodeKeyOnTab({
          spec: priorSpec,
          priorFlows,
          tabId,
          value: input.source_node_id,
          field: 'source_node_id',
          subject: 'Source node',
        });
        if (!sourceKey.ok) {
          throw new ValidationFailedError(sourceKey.message, []);
        }
        const targetKeys: string[] = [];
        const guidance: NodeKeyResolutionGuidance[] =
          sourceKey.guidance !== undefined ? [sourceKey.guidance] : [];
        for (const [index, tid] of input.target_node_ids.entries()) {
          const targetKey = resolveNodeKeyOnTab({
            spec: priorSpec,
            priorFlows,
            tabId,
            value: tid,
            field: `target_node_ids[${index}]`,
            subject: 'Target node',
            notFoundSuffix: ' (cross-tab wires require link nodes)',
          });
          if (!targetKey.ok) {
            throw new ValidationFailedError(targetKey.message, []);
          }
          targetKeys.push(targetKey.key);
          if (targetKey.guidance !== undefined) guidance.push(targetKey.guidance);
        }
        const {
          spec: nextSpec,
          removed,
          added,
        } = setWires(priorSpec, {
          tabId,
          sourceKey: sourceKey.key,
          outputPort: input.output_port ?? 0,
          targetKeys,
        });
        return { nextSpec, extras: { removed, added, guidance } };
      },
      (base, extras) =>
        attachNodeKeyResolutionGuidance(
          {
            ok: base.ok,
            staged_hash: base.staged_hash,
            based_on_snapshot_hash: base.based_on_snapshot_hash,
            based_on_rev: base.based_on_rev,
            diff_summary: base.diff_summary,
            wires_removed_count: extras.removed,
            wires_added_count: extras.added,
            diagnostics: [...base.diagnostics],
            render: base.render,
          },
          extras.guidance,
        ),
    ),
};
