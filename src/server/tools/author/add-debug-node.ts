import { z } from 'zod';

import { addDebugNode } from '../../../toolkit/authoring/operations/add-debug-node.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  attachNodeKeyResolutionGuidance,
  resolveNodeKeyOnTab,
  type NodeKeyResolutionGuidance,
} from './_node-key-resolution.js';
import {
  findNewNodeId,
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    source_node_id: z.string().min(1, 'source_node_id is required'),
    opts: z
      .object({
        label: z.string().max(24).optional(),
        complete: z.string().optional(),
        active: z.boolean().optional(),
        console: z.boolean().optional(),
        source_output_port: z.number().int().nonnegative().optional(),
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
  added_wire: z.object({ from: z.string(), output_port: z.number(), to: z.string() }).optional(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const addDebugNodeTool: Tool<Input, Output> = {
  name: 'add_debug_node',
  description: withStagedAuthorToolDescription(
    'Stages a new `debug` node connected to the given source node on a tab. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      source_node_id: { type: 'string', minLength: 1 },
      opts: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 24 },
          complete: { type: 'string' },
          active: { type: 'boolean' },
          console: { type: 'boolean' },
          source_output_port: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    required: ['tab_id', 'source_node_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<
      { tabId: string; newNodeKey: string; guidance: readonly NodeKeyResolutionGuidance[] },
      Output
    >(
      ctx,
      { toolName: 'add_debug_node' },
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
        const opts: Parameters<typeof addDebugNode>[3] = {};
        if (input.opts?.label !== undefined) opts.label = input.opts.label;
        if (input.opts?.complete !== undefined) opts.complete = input.opts.complete;
        if (input.opts?.active !== undefined) opts.active = input.opts.active;
        if (input.opts?.console !== undefined) opts.console = input.opts.console;
        if (input.opts?.source_output_port !== undefined) {
          opts.sourceOutputPort = input.opts.source_output_port;
        }
        const { spec: nextSpec, newNodeKey } = addDebugNode(priorSpec, tabId, sourceKey.key, opts);
        return {
          nextSpec,
          extras: {
            tabId,
            newNodeKey,
            guidance: sourceKey.guidance !== undefined ? [sourceKey.guidance] : [],
          },
        };
      },
      (base, extras) => {
        const newNodeId = findNewNodeId(base.compiledFlows, extras.tabId, extras.newNodeKey);
        return attachNodeKeyResolutionGuidance(
          {
            ok: base.ok,
            staged_hash: base.staged_hash,
            based_on_snapshot_hash: base.based_on_snapshot_hash,
            based_on_rev: base.based_on_rev,
            diff_summary: base.diff_summary,
            diagnostics: [...base.diagnostics],
            render: base.render,
            ...(newNodeId !== undefined
              ? {
                  added_node_id: newNodeId,
                  added_wire: {
                    from: input.source_node_id,
                    output_port: input.opts?.source_output_port ?? 0,
                    to: newNodeId,
                  },
                }
              : {}),
          },
          extras.guidance,
        );
      },
    ),
};
