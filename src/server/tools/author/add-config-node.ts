import { z } from 'zod';

import { getNodeSchema } from '../../../toolkit/authoring/node-schemas.js';
import { addConfigNode } from '../../../toolkit/authoring/operations/add-config-node.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  findNewConfigNodeId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    key: z.string().min(1, 'key is required'),
    type: z.string().min(1, 'type is required (e.g. "mqtt-broker")'),
    label: z.string().max(24).optional(),
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
  added_config_node_id: z.string().optional(),
  type_had_schema: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const addConfigNodeTool: Tool<Input, Output> = {
  name: 'add_config_node',
  description: withStagedAuthorToolDescription(
    'Stages a new global config node such as mqtt-broker or tls-config. Takes key, type, optional label, and passthrough fields; known types validate passthrough through the NODE_SCHEMAS registry. Config nodes never receive canvas fields, and FlowOtter rejects credential authoring. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', minLength: 1 },
      type: {
        type: 'string',
        minLength: 1,
        description:
          'Node-RED config node type, exactly as it appears in flows.json. Common: "mqtt-broker", "tls-config", "ui-base", "ui-page", "ui-group", "ui-theme".',
      },
      label: { type: 'string', maxLength: 24 },
      passthrough: { type: 'object', additionalProperties: true },
    },
    required: ['key', 'type'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ newConfigNodeKey: string; typeHadSchema: boolean }, Output>(
      ctx,
      { toolName: 'add_config_node', reason: `add_config_node:${input.type}` },
      (priorSpec, _priorFlows) => {
        rejectCredentialsPassthrough(input.type, input.passthrough);
        const { passthrough, typeHadSchema } = validatePassthrough(input.type, input.passthrough);

        const opts: Parameters<typeof addConfigNode>[1] = {
          key: input.key,
          type: input.type,
        };
        if (input.label !== undefined) opts.label = input.label;
        if (passthrough !== undefined) opts.passthrough = passthrough;

        const { spec: nextSpec, newConfigNodeKey } = addConfigNode(priorSpec, opts);
        return { nextSpec, extras: { newConfigNodeKey, typeHadSchema } };
      },
      (base, extras) => {
        const newConfigNodeId = findNewConfigNodeId(base.compiledFlows, extras.newConfigNodeKey);
        return {
          ok: base.ok,
          staged_hash: base.staged_hash,
          based_on_snapshot_hash: base.based_on_snapshot_hash,
          based_on_rev: base.based_on_rev,
          diff_summary: base.diff_summary,
          ...(newConfigNodeId !== undefined ? { added_config_node_id: newConfigNodeId } : {}),
          type_had_schema: extras.typeHadSchema,
          diagnostics: [...base.diagnostics],
          render: base.render,
        };
      },
    ),
};

function validatePassthrough(
  type: string,
  passthrough: Record<string, unknown> | undefined,
): { passthrough: Record<string, unknown> | undefined; typeHadSchema: boolean } {
  const schema = getNodeSchema(type);
  const typeHadSchema = schema !== undefined;
  if (schema === undefined) return { passthrough, typeHadSchema };

  if (passthrough !== undefined) {
    const parseResult = schema.safeParse(passthrough);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new ValidationFailedError(
        `passthrough for type '${type}' failed schema validation: ${issues}`,
        parseResult.error.issues,
      );
    }
    return { passthrough: parseResult.data as Record<string, unknown>, typeHadSchema };
  }

  const empty = schema.safeParse({});
  return {
    passthrough: empty.success ? (empty.data as Record<string, unknown>) : undefined,
    typeHadSchema,
  };
}

function rejectCredentialsPassthrough(
  type: string,
  passthrough: Record<string, unknown> | undefined,
): void {
  if (passthrough === undefined) return;
  if (!Object.prototype.hasOwnProperty.call(passthrough, 'credentials')) return;
  throw new ValidationFailedError(
    `passthrough for config node type '${type}' includes 'credentials'. FlowOtter credentials are not authored; omit the credentials key and fill credential fields in the Node-RED editor after deploy.`,
    [],
  );
}
