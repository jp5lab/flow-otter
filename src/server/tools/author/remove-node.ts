import { z } from 'zod';

import { removeNode } from '../../../toolkit/authoring/operations/remove-node.js';
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
    tab_id: z.string().min(1, 'tab_id is required'),
    node_key: z.string().min(1, 'node_key is required'),
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
  removed: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const removeNodeTool: Tool<Input, Output> = {
  name: 'remove_node',
  description: withStagedAuthorToolDescription(
    'Stages removal of an existing node from a tab. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      node_key: { type: 'string', minLength: 1 },
    },
    required: ['tab_id', 'node_key'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ removed: boolean; guidance: readonly NodeKeyResolutionGuidance[] }, Output>(
      ctx,
      { toolName: 'remove_node' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const nodeKey = resolveNodeKeyOnTab({
          spec: priorSpec,
          priorFlows,
          tabId,
          value: input.node_key,
          field: 'node_key',
        });
        if (!nodeKey.ok && nodeKey.reason !== 'key-not-found') {
          throw new ValidationFailedError(nodeKey.message, []);
        }
        const resolvedNodeKey = nodeKey.ok ? nodeKey.key : input.node_key;
        const { spec: nextSpec, removed } = removeNode(priorSpec, tabId, resolvedNodeKey);
        return {
          nextSpec,
          extras: {
            removed,
            guidance: nodeKey.ok && nodeKey.guidance !== undefined ? [nodeKey.guidance] : [],
          },
        };
      },
      (base, extras) =>
        attachNodeKeyResolutionGuidance(
          {
            ok: base.ok,
            staged_hash: base.staged_hash,
            based_on_snapshot_hash: base.based_on_snapshot_hash,
            based_on_rev: base.based_on_rev,
            diff_summary: base.diff_summary,
            removed: extras.removed,
            diagnostics: [...base.diagnostics],
            render: base.render,
          },
          extras.guidance,
        ),
    ),
};
