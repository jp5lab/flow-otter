import { z } from 'zod';

import { wireNodes } from '../../../toolkit/authoring/operations/wire.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  attachNodeKeyResolutionGuidance,
  resolveNodeKeyOnTab,
  type NodeKeyResolutionGuidance,
} from './_node-key-resolution.js';
import { resolveTabId, runStagedAuthorOp } from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    from_key: z.string().min(1, 'from_key is required'),
    to_key: z.string().min(1, 'to_key is required'),
    output_port: z.number().int().nonnegative().optional(),
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
  wire_added: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const wireNodesTool: Tool<Input, Output> = {
  name: 'wire_nodes',
  description:
    'Stages a wire between two existing nodes on a tab. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      from_key: { type: 'string', minLength: 1 },
      to_key: { type: 'string', minLength: 1 },
      output_port: { type: 'integer', minimum: 0 },
    },
    required: ['tab_id', 'from_key', 'to_key'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ added: boolean; guidance: readonly NodeKeyResolutionGuidance[] }, Output>(
      ctx,
      { toolName: 'wire_nodes' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const fromKey = resolveNodeKeyOnTab({
          spec: priorSpec,
          priorFlows,
          tabId,
          value: input.from_key,
          field: 'from_key',
          subject: 'Source node',
        });
        if (!fromKey.ok) {
          throw new ValidationFailedError(fromKey.message, []);
        }
        const toKey = resolveNodeKeyOnTab({
          spec: priorSpec,
          priorFlows,
          tabId,
          value: input.to_key,
          field: 'to_key',
          subject: 'Target node',
        });
        if (!toKey.ok) {
          throw new ValidationFailedError(toKey.message, []);
        }
        const { spec: nextSpec, added } = wireNodes(priorSpec, tabId, fromKey.key, toKey.key, {
          ...(input.output_port !== undefined ? { outputPort: input.output_port } : {}),
        });
        return {
          nextSpec,
          extras: {
            added,
            guidance: [fromKey.guidance, toKey.guidance].filter(
              (g): g is NodeKeyResolutionGuidance => g !== undefined,
            ),
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
            wire_added: extras.added,
            diagnostics: [...base.diagnostics],
            render: base.render,
          },
          extras.guidance,
        ),
    ),
};
