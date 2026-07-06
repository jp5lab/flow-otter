import { z } from 'zod';

import { isGroup, isTab, type FlowsJson } from '../../../shared/flows-json.js';
import { updateGroup } from '../../../toolkit/authoring/operations/update-group.js';
import type { AuthoringSpec } from '../../../toolkit/authoring/types.js';
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
    group_key: z.string().min(1, 'group_key is required'),
    name: z.string().min(1).max(24).optional(),
    node_keys: z.array(z.string().min(1)).optional(),
    position: PositionSchema.optional(),
    size: SizeSchema.optional(),
    parent_key: z.string().min(1).nullable().optional(),
    info: z.string().nullable().optional(),
    style: z.record(z.unknown()).nullable().optional(),
    passthrough: z.record(z.unknown()).optional(),
    refit: z.boolean().optional(),
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

export const updateGroupTool: Tool<Input, Output> = {
  name: 'update_group',
  description: withStagedAuthorToolDescription(
    'Stages updates to an existing visual group. Supports name, membership across nodes/junctions/comments, geometry, parent group, info, style, passthrough, and refit:true to recompute geometry from members. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      group_key: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 24 },
      node_keys: { type: 'array', items: { type: 'string', minLength: 1 } },
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
      parent_key: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
      info: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      style: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
      passthrough: { type: 'object', additionalProperties: true },
      refit: {
        type: 'boolean',
        description:
          'When true, strips position and size so compile auto-fits group geometry from current members.',
      },
    },
    required: ['tab_id', 'group_key'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ updated: boolean; guidance: readonly NodeKeyResolutionGuidance[] }, Output>(
      ctx,
      { toolName: 'update_group' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const groupKey = resolveGroupKeyOnTab(priorSpec, priorFlows, tabId, input.group_key);
        const guidance: NodeKeyResolutionGuidance[] = [];
        const opts: Parameters<typeof updateGroup>[3] = {};
        if (input.name !== undefined) opts.name = input.name;
        if (input.node_keys !== undefined) {
          opts.nodeKeys = input.node_keys.map((value, index) => {
            const resolved = resolveCanvasObjectKeyOnTab({
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
        if (input.passthrough !== undefined) opts.passthrough = input.passthrough;
        if (input.refit !== undefined) opts.refit = input.refit;

        const { spec: nextSpec, updated } = updateGroup(priorSpec, tabId, groupKey, opts);
        return { nextSpec, extras: { updated, guidance } };
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

function resolveGroupKeyOnTab(
  spec: AuthoringSpec,
  priorFlows: FlowsJson,
  tabId: string,
  value: string,
): string {
  const tab = spec.tabs.find((t) => t.id === tabId);
  if (tab === undefined) throw new ValidationFailedError(`Tab '${tabId}' not found in spec.`, []);
  if (tab.groups.some((g) => g.key === value)) return value;

  const group = priorFlows.find((n) => isGroup(n) && n.id === value);
  if (group === undefined) {
    throw new ValidationFailedError(`Group '${value}' not found on tab '${tabId}'.`, []);
  }
  const nodeRedTabId = typeof group.z === 'string' ? group.z : undefined;
  if (nodeRedTabId === undefined) {
    throw new ValidationFailedError(`Group '${value}' is missing a tab id.`, []);
  }
  const authoringTabId = authoringTabIdForNodeRedTabId(priorFlows, nodeRedTabId);
  if (authoringTabId !== tabId) {
    throw new ValidationFailedError(
      `Group '${value}' is a Node-RED group id on tab '${authoringTabId ?? nodeRedTabId}', not tab '${tabId}'.`,
      [],
    );
  }
  const key = authoringKeyForFlowNode(group);
  if (!tab.groups.some((g) => g.key === key)) {
    throw new ValidationFailedError(`Group '${value}' not found on tab '${tabId}'.`, []);
  }
  return key;
}

function authoringTabIdForNodeRedTabId(
  priorFlows: FlowsJson,
  nodeRedTabId: string,
): string | undefined {
  const tab = priorFlows.find((n) => isTab(n) && n.id === nodeRedTabId);
  if (tab === undefined) return undefined;
  return authoringKeyForFlowNode(tab);
}

function authoringKeyForFlowNode(node: FlowsJson[number]): string {
  const ext = (node as Record<string, unknown>)['_authoringKey'];
  return typeof ext === 'string' ? ext : node.id;
}
