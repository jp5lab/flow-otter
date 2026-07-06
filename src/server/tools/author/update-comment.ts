import { z } from 'zod';

import { updateComment } from '../../../toolkit/authoring/operations/update-comment.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  attachNodeKeyResolutionGuidance,
  resolveCanvasObjectKeyOnTab,
  type NodeKeyResolutionGuidance,
} from './_node-key-resolution.js';
import {
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const PositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

const SizeSchema = z
  .object({
    w: z.number().positive(),
    h: z.number().positive(),
  })
  .strict();

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    comment_key: z.string().min(1, 'comment_key is required'),
    text: z.string().min(1).optional(),
    position: PositionSchema.optional(),
    size: SizeSchema.nullable().optional(),
    info: z.string().nullable().optional(),
    group_key: z.string().min(1).nullable().optional(),
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
  updated: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const updateCommentTool: Tool<Input, Output> = {
  name: 'update_comment',
  description: withStagedAuthorToolDescription(
    'Stages updates to an existing comment on a tab. Supports text, position, size, info, and group membership. Pass null for size, info, or group_key to clear it. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      comment_key: { type: 'string', minLength: 1 },
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
      size: {
        anyOf: [
          {
            type: 'object',
            properties: {
              w: { type: 'number', exclusiveMinimum: 0 },
              h: { type: 'number', exclusiveMinimum: 0 },
            },
            required: ['w', 'h'],
            additionalProperties: false,
          },
          { type: 'null' },
        ],
      },
      info: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      group_key: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
    },
    required: ['tab_id', 'comment_key'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ updated: boolean; guidance: readonly NodeKeyResolutionGuidance[] }, Output>(
      ctx,
      { toolName: 'update_comment' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const commentKey = resolveCanvasObjectKeyOnTab({
          spec: priorSpec,
          priorFlows,
          tabId,
          value: input.comment_key,
          field: 'comment_key',
          subject: 'Comment',
        });
        if (!commentKey.ok) {
          throw new ValidationFailedError(commentKey.message, []);
        }
        if (commentKey.kind !== 'comment') {
          throw new ValidationFailedError(
            `Comment '${input.comment_key}' resolved to a ${commentKey.kind}; use update_comment only for comments.`,
            [],
          );
        }

        const opts: Parameters<typeof updateComment>[3] = {};
        if (input.text !== undefined) opts.text = input.text;
        if (input.position !== undefined) opts.position = input.position;
        if (input.size !== undefined) opts.size = input.size;
        if (input.info !== undefined) opts.info = input.info;
        if (input.group_key !== undefined) opts.groupKey = input.group_key;

        const { spec: nextSpec, updated } = updateComment(priorSpec, tabId, commentKey.key, opts);
        return {
          nextSpec,
          extras: {
            updated,
            guidance: commentKey.guidance !== undefined ? [commentKey.guidance] : [],
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
            updated: extras.updated,
            diagnostics: [...base.diagnostics],
            render: base.render,
          },
          extras.guidance,
        ),
    ),
};
