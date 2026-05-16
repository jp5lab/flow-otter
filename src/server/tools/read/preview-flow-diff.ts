import { z } from 'zod';

import { diffFlows, summarizeDiff } from '../../../toolkit/diff/semantic.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    against: z.enum(['staged', 'snapshot']).optional(),
    snapshot_id: z.string().optional(),
    env: z.string().optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const WireRefSchema = z.object({
  fromId: z.string(),
  outputPort: z.number().int().nonnegative(),
  toId: z.string(),
});

const NodeChangeSchema = z.object({
  id: z.string(),
  type: z.string(),
  tabId: z.string().optional(),
});

const NodeModificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  tabId: z.string().optional(),
  fields: z.array(z.string()),
  before: z.record(z.unknown()),
  after: z.record(z.unknown()),
});

const OutputSchema = z.object({
  mode: z.enum(['staged', 'snapshot']),
  summary: z.object({
    nodes_added: z.number().int(),
    nodes_removed: z.number().int(),
    nodes_modified: z.number().int(),
    wires_added: z.number().int(),
    wires_removed: z.number().int(),
  }),
  added: z.object({ nodes: z.array(NodeChangeSchema), wires: z.array(WireRefSchema) }),
  removed: z.object({ nodes: z.array(NodeChangeSchema), wires: z.array(WireRefSchema) }),
  modified: z.object({ nodes: z.array(NodeModificationSchema) }),
});
type Output = z.infer<typeof OutputSchema>;

export const previewFlowDiffTool: Tool<Input, Output> = {
  name: 'preview_flow_diff',
  description:
    'Computes a semantic diff between the current runtime flows and either the staged change or a named snapshot. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      against: { type: 'string', enum: ['staged', 'snapshot'] },
      snapshot_id: { type: 'string' },
      env: { type: 'string' },
    },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const mode = input.against ?? 'staged';
    const { flows: runtime } = await ctx.flowSource.load();
    let target;
    if (mode === 'staged') {
      const staged = await ctx.staging.read();
      if (!staged) throw new ValidationFailedError('No staged change to compare against.', []);
      target = staged.flows;
    } else {
      if (input.snapshot_id === undefined) {
        throw new ValidationFailedError(
          "preview_flow_diff against 'snapshot' requires snapshot_id.",
          [],
        );
      }
      const refs = await ctx.snapshots.list(input.env !== undefined ? { env: input.env } : {});
      const ref = refs.find((r) => r.id === input.snapshot_id);
      if (!ref) throw new ValidationFailedError(`Snapshot '${input.snapshot_id}' not found.`, []);
      const payload = await ctx.snapshots.load(ref);
      target = payload.flows;
    }
    const diff = diffFlows(runtime, target);
    return {
      mode,
      summary: summarizeDiff(diff),
      added: { nodes: [...diff.added.nodes], wires: [...diff.added.wires] },
      removed: { nodes: [...diff.removed.nodes], wires: [...diff.removed.wires] },
      modified: {
        nodes: diff.modified.nodes.map((m) => ({
          id: m.id,
          type: m.type,
          ...(m.tabId !== undefined ? { tabId: m.tabId } : {}),
          fields: [...m.fields],
          before: { ...m.before },
          after: { ...m.after },
        })),
      },
    };
  },
};
