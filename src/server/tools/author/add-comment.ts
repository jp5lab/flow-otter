import { z } from 'zod';

import type { FlowsJson } from '../../../shared/flows-json.js';
import { addComment } from '../../../toolkit/authoring/operations/add-comment.js';
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
    tab_id: z.string().min(1, 'tab_id is required'),
    text: z.string().min(1, 'text is required'),
    position: PositionSchema.optional(),
    info: z.string().optional(),
    group_key: z.string().min(1).optional(),
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
  added_comment_id: z.string().optional(),
  diagnostics: z.array(DiagnosticSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const addCommentTool: Tool<Input, Output> = {
  name: 'add_comment',
  description:
    'Stages a new comment on the given tab. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      text: { type: 'string', minLength: 1 },
      position: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
        additionalProperties: false,
      },
      info: { type: 'string' },
      group_key: { type: 'string', minLength: 1 },
    },
    required: ['tab_id', 'text'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ tabId: string; newCommentKey: string }, Output>(
      ctx,
      { toolName: 'add_comment' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const opts: Parameters<typeof addComment>[2] = { text: input.text };
        if (input.position !== undefined) opts.position = input.position;
        if (input.info !== undefined) opts.info = input.info;
        if (input.group_key !== undefined) opts.groupKey = input.group_key;
        const { spec: nextSpec, newCommentKey } = addComment(priorSpec, tabId, opts);
        return { nextSpec, extras: { tabId, newCommentKey } };
      },
      (base, extras) => {
        const newCommentId = findNewCommentId(
          base.compiledFlows,
          extras.tabId,
          extras.newCommentKey,
        );
        return {
          ok: base.ok,
          staged_hash: base.staged_hash,
          based_on_snapshot_hash: base.based_on_snapshot_hash,
          based_on_rev: base.based_on_rev,
          diff_summary: base.diff_summary,
          diagnostics: [...base.diagnostics],
          ...(newCommentId !== undefined ? { added_comment_id: newCommentId } : {}),
        };
      },
    ),
};

function findNewCommentId(flows: FlowsJson, tabId: string, newKey: string): string | undefined {
  for (const n of flows) {
    if (n.type !== 'comment') continue;
    if ((n as { z?: string }).z !== tabId) continue;
    const ext = (n as Record<string, unknown>)['_authoringKey'];
    if (ext === newKey) return n.id;
  }
  return undefined;
}
