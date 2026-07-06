import { z } from 'zod';

import type { FlowsJson } from '../../../shared/flows-json.js';
import { createSubflowDefinition } from '../../../toolkit/authoring/operations/create-subflow-definition.js';
import { type Tool } from '../_tool.js';

import { runStagedAuthorOp, withStagedAuthorToolDescription } from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const PositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

const NodeSchema = z
  .object({
    key: z.string().min(1),
    type: z.string().min(1),
    label: z.string().max(24).optional(),
    position: PositionSchema,
    group_key: z.string().min(1).optional(),
    passthrough: z.record(z.unknown()).optional(),
  })
  .strict();

const ConnectionSchema = z
  .object({
    from_key: z.string().min(1),
    output_port: z.number().int().nonnegative(),
    to_key: z.string().min(1),
  })
  .strict();

const InputSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1, 'name is required').max(24),
    nodes: z.array(NodeSchema).optional(),
    connections: z.array(ConnectionSchema).optional(),
    passthrough: z.record(z.unknown()).optional(),
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
  new_def_id: z.string().optional(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const createSubflowDefinitionTool: Tool<Input, Output> = {
  name: 'create_subflow_definition',
  description: withStagedAuthorToolDescription(
    'Stages a new subflow definition. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 24 },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', minLength: 1 },
            type: { type: 'string', minLength: 1 },
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
          },
          required: ['key', 'type', 'position'],
          additionalProperties: false,
        },
      },
      connections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from_key: { type: 'string', minLength: 1 },
            output_port: { type: 'integer', minimum: 0 },
            to_key: { type: 'string', minLength: 1 },
          },
          required: ['from_key', 'output_port', 'to_key'],
          additionalProperties: false,
        },
      },
      passthrough: { type: 'object', additionalProperties: true },
    },
    required: ['name'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ newDefId: string }, Output>(
      ctx,
      { toolName: 'create_subflow_definition' },
      (priorSpec, _priorFlows) => {
        const opts: Parameters<typeof createSubflowDefinition>[1] = { name: input.name };
        if (input.id !== undefined) opts.id = input.id;
        if (input.nodes !== undefined) {
          opts.nodes = input.nodes.map((n) => ({
            key: n.key,
            type: n.type,
            position: n.position,
            ...(n.label !== undefined ? { label: n.label } : {}),
            ...(n.group_key !== undefined ? { groupKey: n.group_key } : {}),
            ...(n.passthrough !== undefined ? { passthrough: n.passthrough } : {}),
          }));
        }
        if (input.connections !== undefined) {
          opts.connections = input.connections.map((c) => ({
            fromKey: c.from_key,
            outputPort: c.output_port,
            toKey: c.to_key,
          }));
        }
        if (input.passthrough !== undefined) opts.passthrough = input.passthrough;
        const { spec: nextSpec, newDefId } = createSubflowDefinition(priorSpec, opts);
        return { nextSpec, extras: { newDefId } };
      },
      (base, extras) => {
        const compiledDefId = findNewDefId(base.compiledFlows, extras.newDefId);
        return {
          ok: base.ok,
          staged_hash: base.staged_hash,
          based_on_snapshot_hash: base.based_on_snapshot_hash,
          based_on_rev: base.based_on_rev,
          diff_summary: base.diff_summary,
          diagnostics: [...base.diagnostics],
          render: base.render,
          ...(compiledDefId !== undefined ? { new_def_id: compiledDefId } : {}),
        };
      },
    ),
};

function findNewDefId(flows: FlowsJson, newKey: string): string | undefined {
  for (const n of flows) {
    if (n.type !== 'subflow') continue;
    const ext = (n as Record<string, unknown>)['_authoringKey'];
    if (ext === newKey) return n.id;
  }
  return undefined;
}
