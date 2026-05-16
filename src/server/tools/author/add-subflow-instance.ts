import { z } from 'zod';

import { addSubflowInstance } from '../../../toolkit/authoring/operations/add-subflow-instance.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { findNewNodeId, resolveTabId, runStagedAuthorOp } from './_stage-pipeline.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    defId: z.string().min(1, 'defId is required'),
    opts: z
      .object({
        label: z.string().max(24).optional(),
        key: z.string().min(1).optional(),
        passthrough: z.record(z.unknown()).optional(),
        group_key: z.string().min(1).optional(),
      })
      .optional(),
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
  added_node_id: z.string().optional(),
  diagnostics: z.array(DiagnosticSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const addSubflowInstanceTool: Tool<Input, Output> = {
  name: 'add_subflow_instance',
  description:
    'Stages a new subflow instance on the given tab. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      defId: { type: 'string', minLength: 1 },
      opts: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 24 },
          key: { type: 'string', minLength: 1 },
          passthrough: { type: 'object', additionalProperties: true },
          group_key: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    required: ['tab_id', 'defId'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ tabId: string; newNodeKey: string }, Output>(
      ctx,
      { toolName: 'add_subflow_instance' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const opts: Parameters<typeof addSubflowInstance>[3] = {};
        if (input.opts?.label !== undefined) opts.label = input.opts.label;
        if (input.opts?.key !== undefined) opts.key = input.opts.key;
        if (input.opts?.passthrough !== undefined) opts.passthrough = input.opts.passthrough;
        if (input.opts?.group_key !== undefined) opts.groupKey = input.opts.group_key;
        const { spec: nextSpec, newNodeKey } = addSubflowInstance(
          priorSpec,
          tabId,
          input.defId,
          opts,
        );
        return { nextSpec, extras: { tabId, newNodeKey } };
      },
      (base, extras) => {
        const newNodeId = findNewNodeId(base.compiledFlows, extras.tabId, extras.newNodeKey);
        return {
          ok: base.ok,
          staged_hash: base.staged_hash,
          based_on_snapshot_hash: base.based_on_snapshot_hash,
          based_on_rev: base.based_on_rev,
          diff_summary: base.diff_summary,
          diagnostics: [...base.diagnostics],
          ...(newNodeId !== undefined ? { added_node_id: newNodeId } : {}),
        };
      },
    ),
};
