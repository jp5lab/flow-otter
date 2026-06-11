import { z } from 'zod';

import { setLinks } from '../../../toolkit/authoring/operations/set-links.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { resolveAuthoringKey, runStagedAuthorOp } from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    source_node_id: z.string().min(1),
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
  paired_count: z.number(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const setLinksTool: Tool<Input, Output> = {
  name: 'set_links',
  description:
    'Stages a cross-tab pairing on a `link out` or `link call` node by setting its `passthrough.links` to point at one or more `link in` peers. Replaces the existing pairing atomically; pass `target_node_ids: []` to clear. Targets may live on any tab. Does NOT deploy — call `deploy_staged_change`.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      source_node_id: { type: 'string', minLength: 1 },
      target_node_ids: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['source_node_id', 'target_node_ids'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ paired: number }, Output>(
      ctx,
      { toolName: 'set_links' },
      (priorSpec, priorFlows) => {
        const sourceKey = resolveAuthoringKey(priorFlows, input.source_node_id);
        if (sourceKey === undefined) {
          throw new ValidationFailedError(
            `Source node '${input.source_node_id}' not found in current flows.`,
            [],
          );
        }
        const targetKeys: string[] = [];
        for (const tid of input.target_node_ids) {
          const k = resolveAuthoringKey(priorFlows, tid);
          if (k === undefined) {
            throw new ValidationFailedError(`Target node '${tid}' not found in current flows.`, []);
          }
          targetKeys.push(k);
        }
        const { spec: nextSpec, paired } = setLinks(priorSpec, {
          sourceKey,
          targetKeys,
          priorFlows,
        });
        return { nextSpec, extras: { paired } };
      },
      (base, extras) => ({
        ok: base.ok,
        staged_hash: base.staged_hash,
        based_on_snapshot_hash: base.based_on_snapshot_hash,
        based_on_rev: base.based_on_rev,
        diff_summary: base.diff_summary,
        paired_count: extras.paired,
        diagnostics: [...base.diagnostics],
        render: base.render,
      }),
    ),
};
