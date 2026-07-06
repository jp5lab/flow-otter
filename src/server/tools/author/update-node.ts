import { z } from 'zod';

import { applyPatches, PatchError } from '../../../toolkit/authoring/operations/_patches.js';
import { updateNode } from '../../../toolkit/authoring/operations/update-node.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  attachNodeKeyResolutionGuidance,
  resolveNodeKeyOnTab,
  type NodeKeyResolutionGuidance,
} from './_node-key-resolution.js';
import { resolveTabId, runStagedAuthorOp } from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const PositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

const PatchSchema = z
  .object({
    property: z.string().min(1, 'property is required (passthrough field name)'),
    op: z.enum(['replace', 'insert', 'delete']),
    start: z.number().int().min(1, 'start is 1-indexed'),
    end: z.number().int().min(1).optional(),
    content: z.string().optional(),
  })
  .strict();

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    node_key: z.string().min(1, 'node_key is required'),
    label: z.string().max(24).optional(),
    position: PositionSchema.optional(),
    group_key: z.string().min(1).optional(),
    passthrough: z.record(z.unknown()).optional(),
    /**
     * Line-based patches applied to existing passthrough string fields.
     * Use for editing function-node `func`, ui-template `format`, template-node
     * `template` without sending the full property value over the wire.
     * Line numbers (1-indexed) refer to the ORIGINAL property content; patches
     * must be non-overlapping. Per-property merge order: `passthrough` is
     * applied first, then `patches` operate on the resulting strings.
     */
    patches: z.array(PatchSchema).optional(),
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
  patches_applied: z.number().int().nonnegative(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const updateNodeTool: Tool<Input, Output> = {
  name: 'update_node',
  description:
    'Stages updates to an existing node on a tab. Supports two edit modes: (1) full-property `passthrough` (merge over existing), and (2) `patches[]` — line-based replace/insert/delete on string passthrough fields (function-node `func`, ui-template `format`, template-node `template`). Line numbers are 1-indexed and refer to the ORIGINAL content; patches must be non-overlapping. Per-property order: passthrough applied first, then patches. Validates and lints the result; produces a semantic diff. Does NOT deploy.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      node_key: { type: 'string', minLength: 1 },
      label: { type: 'string', maxLength: 24 },
      position: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
        additionalProperties: false,
      },
      group_key: { type: 'string', minLength: 1 },
      passthrough: { type: 'object', additionalProperties: true },
      patches: {
        type: 'array',
        description:
          'Line-based patches on passthrough string properties (function `func`, ui-template `format`, template `template`, ...). 1-indexed lines on ORIGINAL content, non-overlapping.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['property', 'op', 'start'],
          properties: {
            property: { type: 'string', minLength: 1 },
            op: { type: 'string', enum: ['replace', 'insert', 'delete'] },
            start: { type: 'integer', minimum: 1 },
            end: { type: 'integer', minimum: 1 },
            content: { type: 'string' },
          },
        },
      },
    },
    required: ['tab_id', 'node_key'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<
      { updated: boolean; patchesApplied: number; guidance: readonly NodeKeyResolutionGuidance[] },
      Output
    >(
      ctx,
      { toolName: 'update_node' },
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
        const guidance = nodeKey.ok && nodeKey.guidance !== undefined ? [nodeKey.guidance] : [];

        // Compute the passthrough patches first — apply `patches[]` on top of
        // whatever passthrough merge the agent supplied (or the existing
        // passthrough if no merge was supplied). Result becomes the effective
        // `passthrough` override.
        let effectivePassthrough = input.passthrough;
        let patchesApplied = 0;
        if (input.patches && input.patches.length > 0) {
          if (!nodeKey.ok) {
            throw new ValidationFailedError(nodeKey.message, []);
          }
          const byProperty = new Map<string, typeof input.patches>();
          for (const p of input.patches) {
            const list = byProperty.get(p.property) ?? [];
            list.push(p);
            byProperty.set(p.property, list);
          }
          const merged: Record<string, unknown> = {
            ...(nodeKey.node.passthrough ?? {}),
            ...(input.passthrough ?? {}),
          };
          for (const [property, propPatches] of byProperty) {
            const current = merged[property];
            const baseline = typeof current === 'string' ? current : '';
            try {
              merged[property] = applyPatches(baseline, propPatches);
            } catch (err) {
              if (err instanceof PatchError) {
                throw new ValidationFailedError(
                  `patches on property '${property}': ${err.message}`,
                  [],
                );
              }
              throw err;
            }
            patchesApplied += propPatches.length;
          }
          effectivePassthrough = merged;
        }

        const opts: Parameters<typeof updateNode>[3] = {};
        if (input.label !== undefined) opts.label = input.label;
        if (input.position !== undefined) opts.position = input.position;
        if (input.group_key !== undefined) opts.groupKey = input.group_key;
        if (effectivePassthrough !== undefined) opts.passthrough = effectivePassthrough;

        const { spec: nextSpec, updated } = updateNode(priorSpec, tabId, resolvedNodeKey, opts);
        return { nextSpec, extras: { updated, patchesApplied, guidance } };
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
            patches_applied: extras.patchesApplied,
            diagnostics: [...base.diagnostics],
            render: base.render,
          },
          extras.guidance,
        ),
    ),
};
