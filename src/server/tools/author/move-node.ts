import { z } from 'zod';

import { moveNode } from '../../../toolkit/authoring/operations/move-node.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { resolveTabId, runStagedAuthorOp } from './_stage-pipeline.js';

const PositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

const InputSchema = z
  .object({
    source_tab_id: z.string().min(1, 'source_tab_id is required'),
    node_key: z.string().min(1, 'node_key is required'),
    dest_tab_id: z.string().min(1).optional(),
    position: PositionSchema.optional(),
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
  moved_node_key: z.string(),
  source_tab_id: z.string(),
  dest_tab_id: z.string(),
  diagnostics: z.array(DiagnosticSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const moveNodeTool: Tool<Input, Output> = {
  name: 'move_node',
  description:
    'Stages a move or reposition of an existing node. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      source_tab_id: { type: 'string', minLength: 1 },
      node_key: { type: 'string', minLength: 1 },
      dest_tab_id: { type: 'string', minLength: 1 },
      position: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
        additionalProperties: false,
      },
    },
    required: ['source_tab_id', 'node_key'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ sourceTabId: string; destTabId: string }, Output>(
      ctx,
      { toolName: 'move_node' },
      (priorSpec) => {
        const sourceTabId = resolveTabId(priorSpec, input.source_tab_id);
        if (!sourceTabId) {
          throw new ValidationFailedError(
            `Source tab '${input.source_tab_id}' not found in current flows.`,
            [],
          );
        }
        const destTabId =
          input.dest_tab_id !== undefined
            ? resolveTabId(priorSpec, input.dest_tab_id)
            : sourceTabId;
        if (!destTabId) {
          throw new ValidationFailedError(
            `Destination tab '${input.dest_tab_id ?? ''}' not found in current flows.`,
            [],
          );
        }
        const { spec: nextSpec } = moveNode(priorSpec, sourceTabId, input.node_key, {
          ...(input.dest_tab_id !== undefined ? { destTabId } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
        });
        return { nextSpec, extras: { sourceTabId, destTabId } };
      },
      (base, extras) => ({
        ok: base.ok,
        staged_hash: base.staged_hash,
        based_on_snapshot_hash: base.based_on_snapshot_hash,
        based_on_rev: base.based_on_rev,
        diff_summary: base.diff_summary,
        moved_node_key: input.node_key,
        source_tab_id: extras.sourceTabId,
        dest_tab_id: extras.destTabId,
        diagnostics: [...base.diagnostics],
      }),
    ),
};
