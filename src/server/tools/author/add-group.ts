import { z } from 'zod';

import type { FlowsJson } from '../../../shared/flows-json.js';
import { addGroup } from '../../../toolkit/authoring/operations/add-group.js';
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
    key: z.string().min(1).optional(),
    name: z.string().min(1, 'name is required').max(24),
    node_keys: z.array(z.string().min(1)).optional(),
    position: PositionSchema.optional(),
    size: SizeSchema.optional(),
    parent_key: z.string().min(1).optional(),
    info: z.string().optional(),
    style: z.record(z.unknown()).optional(),
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
  added_group_id: z.string().optional(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const addGroupTool: Tool<Input, Output> = {
  name: 'add_group',
  description: withStagedAuthorToolDescription(
    'Stages a new visual group on the given tab. Supports node membership, position, size, parent group, info, and style so agents can sketch readable Node-RED sections before programming internals. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      key: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 24 },
      node_keys: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
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
        type: 'object',
        properties: {
          w: { type: 'number', exclusiveMinimum: 0 },
          h: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['w', 'h'],
        additionalProperties: false,
      },
      parent_key: { type: 'string', minLength: 1 },
      info: { type: 'string' },
      style: { type: 'object', additionalProperties: true },
    },
    required: ['tab_id', 'name'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<
      { tabId: string; newGroupKey: string; guidance: readonly NodeKeyResolutionGuidance[] },
      Output
    >(
      ctx,
      { toolName: 'add_group' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const opts: Parameters<typeof addGroup>[2] = { name: input.name };
        if (input.key !== undefined) opts.key = input.key;
        const guidance: NodeKeyResolutionGuidance[] = [];
        if (input.node_keys !== undefined) {
          opts.nodeKeys = input.node_keys.map((value, index) => {
            const resolved = resolveNodeKeyOnTab({
              spec: priorSpec,
              priorFlows,
              tabId,
              value,
              field: `node_keys[${index}]`,
            });
            if (!resolved.ok) {
              if (resolved.reason !== 'key-not-found') {
                throw new ValidationFailedError(resolved.message, []);
              }
              return value;
            }
            if (resolved.guidance !== undefined) guidance.push(resolved.guidance);
            return resolved.key;
          });
        }
        if (input.position !== undefined) opts.position = input.position;
        if (input.size !== undefined) opts.size = input.size;
        if (input.parent_key !== undefined) opts.parentKey = input.parent_key;
        if (input.info !== undefined) opts.info = input.info;
        if (input.style !== undefined) opts.style = input.style;
        const { spec: nextSpec, newGroupKey } = addGroup(priorSpec, tabId, opts);
        return { nextSpec, extras: { tabId, newGroupKey, guidance } };
      },
      (base, extras) => {
        const newGroupId = findNewGroupId(base.compiledFlows, extras.tabId, extras.newGroupKey);
        return attachNodeKeyResolutionGuidance(
          {
            ok: base.ok,
            staged_hash: base.staged_hash,
            based_on_snapshot_hash: base.based_on_snapshot_hash,
            based_on_rev: base.based_on_rev,
            diff_summary: base.diff_summary,
            diagnostics: [...base.diagnostics],
            render: base.render,
            ...(newGroupId !== undefined ? { added_group_id: newGroupId } : {}),
          },
          extras.guidance,
        );
      },
    ),
};

function findNewGroupId(flows: FlowsJson, tabId: string, newKey: string): string | undefined {
  for (const n of flows) {
    if (n.type !== 'group') continue;
    if ((n as { z?: string }).z !== tabId) continue;
    const ext = (n as Record<string, unknown>)['_authoringKey'];
    if (ext === newKey) return n.id;
  }
  return undefined;
}
