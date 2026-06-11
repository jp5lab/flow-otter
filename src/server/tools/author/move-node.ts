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

/**
 * Tab addressing (WSB-6, 2026-06-10 layout-audit fix plan, e3#2): `tab_id`
 * is the canonical parameter name — the same vocabulary every other author
 * tool uses. `source_tab_id` is the historical outlier, kept as a deprecated
 * alias for back-compat; removal is slated for v2.0.0. Exactly one is
 * required; if both are supplied they must agree.
 */
const InputSchema = z
  .object({
    tab_id: z.string().min(1).optional(),
    source_tab_id: z.string().min(1).optional(),
    node_key: z.string().min(1, 'node_key is required'),
    dest_tab_id: z.string().min(1).optional(),
    position: PositionSchema.optional(),
  })
  .strict()
  .superRefine((val, refCtx) => {
    if (val.tab_id === undefined && val.source_tab_id === undefined) {
      refCtx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tab_id'],
        message: 'tab_id is required (source_tab_id is its deprecated alias)',
      });
    }
    if (
      val.tab_id !== undefined &&
      val.source_tab_id !== undefined &&
      val.tab_id !== val.source_tab_id
    ) {
      refCtx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_tab_id'],
        message: `tab_id ('${val.tab_id}') and its deprecated alias source_tab_id ('${val.source_tab_id}') disagree — pass tab_id only`,
      });
    }
  });
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
    'Stages a move or reposition of an existing node. Takes `tab_id` (the tab currently holding the node — same vocabulary as every other author tool; `source_tab_id` is a DEPRECATED alias slated for removal in v2.0.0) plus optional `dest_tab_id` for cross-tab moves. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: {
        type: 'string',
        minLength: 1,
        description:
          'Tab currently holding the node (canonical — the same parameter name every other author tool uses).',
      },
      source_tab_id: {
        type: 'string',
        minLength: 1,
        description:
          'DEPRECATED alias of tab_id, kept for back-compat; removal slated for v2.0.0. If both are supplied they must agree.',
      },
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
    required: ['node_key'],
    anyOf: [{ required: ['tab_id'] }, { required: ['source_tab_id'] }],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ sourceTabId: string; destTabId: string }, Output>(
      ctx,
      { toolName: 'move_node' },
      (priorSpec, priorFlows) => {
        // Zod guarantees at least one of the two spellings (and agreement
        // when both are present); the alias resolution is a plain fallback.
        const tabRef = input.tab_id ?? input.source_tab_id;
        if (tabRef === undefined) {
          throw new ValidationFailedError(
            'tab_id is required (source_tab_id is its deprecated alias).',
            [],
          );
        }
        const sourceTabId = resolveTabId(priorFlows, tabRef);
        if (!sourceTabId) {
          throw new ValidationFailedError(`Source tab '${tabRef}' not found in current flows.`, []);
        }
        const destTabId =
          input.dest_tab_id !== undefined
            ? resolveTabId(priorFlows, input.dest_tab_id)
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
