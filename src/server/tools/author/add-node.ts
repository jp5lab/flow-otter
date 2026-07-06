import { z } from 'zod';

import { getNodeSchema } from '../../../toolkit/authoring/node-schemas.js';
import { addNode } from '../../../toolkit/authoring/operations/add-node.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  attachNodeKeyResolutionGuidance,
  resolveNodeKeyOnTab,
  type NodeKeyResolutionGuidance,
} from './_node-key-resolution.js';
import {
  findNewConfigNodeId,
  findNewNodeId,
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    type: z.string().min(1, 'type is required (e.g. "change", "switch", "http in")'),
    opts: z
      .object({
        key: z.string().min(1).optional(),
        label: z.string().max(24).optional(),
        position: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
        group_key: z.string().min(1).optional(),
        passthrough: z.record(z.unknown()).optional(),
        source_node_id: z.string().min(1).optional(),
        source_output_port: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
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
  added_node_id: z.string().optional(),
  added_wire: z.object({ from: z.string(), output_port: z.number(), to: z.string() }).optional(),
  type_had_schema: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const addNodeTool: Tool<Input, Output> = {
  name: 'add_node',
  description: withStagedAuthorToolDescription(
    'Generic node-add: stages a new node of any Node-RED type on a tab; known config-node types (e.g. "mqtt-broker") are staged globally without canvas fields. Pass `type` (e.g. "change", "switch", "http in") and optional `opts.passthrough` for per-type config. If a per-type Zod schema is registered for the node type, `passthrough` is validated against it. Optionally wires from `opts.source_node_id`. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['tab_id', 'type'],
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      type: {
        type: 'string',
        minLength: 1,
        description:
          'Node-RED type, exactly as it appears in flows.json. Common: "change", "switch", "function", "template", "delay", "trigger", "http in", "http response", "http request", "csv", "json", "xml", "file in", "file", "exec", "debug", "inject", "mqtt in", "mqtt out", "link in", "link out", "link call". Dashboard 2.0 widget types use add_dashboard_widget instead.',
      },
      opts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', minLength: 1 },
          label: { type: 'string', maxLength: 24 },
          position: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          },
          group_key: { type: 'string', minLength: 1 },
          passthrough: { type: 'object', additionalProperties: true },
          source_node_id: { type: 'string', minLength: 1 },
          source_output_port: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<
      {
        tabId: string;
        newNodeKey: string;
        wired: boolean;
        kind: 'node' | 'config';
        typeHadSchema: boolean;
        guidance: readonly NodeKeyResolutionGuidance[];
      },
      Output
    >(
      ctx,
      { toolName: 'add_node', reason: `add_node:${input.type}` },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        rejectCredentialsPassthrough(input.type, input.opts?.passthrough);

        // Validate passthrough against per-type schema if registered. When
        // the caller omits passthrough entirely, ATTEMPT parse({}) so the
        // schema's runtime-required defaults (inject.repeat, complete.scope,
        // link links arrays, …) materialize — agents shouldn't need to know
        // them. Schemas with required fields and no defaults (e.g. change's
        // rules) simply skip materialization; omitting passthrough is never
        // an error.
        const schema = getNodeSchema(input.type);
        const typeHadSchema = schema !== undefined;
        let validatedPassthrough: Record<string, unknown> | undefined = input.opts?.passthrough;
        if (schema !== undefined && input.opts?.passthrough !== undefined) {
          const parseResult = schema.safeParse(input.opts.passthrough);
          if (!parseResult.success) {
            const issues = parseResult.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ');
            throw new ValidationFailedError(
              `passthrough for type '${input.type}' failed schema validation: ${issues}`,
              parseResult.error.issues,
            );
          }
          validatedPassthrough = parseResult.data as Record<string, unknown>;
        } else if (schema !== undefined) {
          const empty = schema.safeParse({});
          if (empty.success) validatedPassthrough = empty.data as Record<string, unknown>;
        }

        let sourceKey: string | undefined;
        let guidance: readonly NodeKeyResolutionGuidance[] = [];
        if (input.opts?.source_node_id) {
          const resolvedSourceKey = resolveNodeKeyOnTab({
            spec: priorSpec,
            priorFlows,
            tabId,
            value: input.opts.source_node_id,
            field: 'opts.source_node_id',
            subject: 'Source node',
          });
          if (!resolvedSourceKey.ok) {
            throw new ValidationFailedError(resolvedSourceKey.message, []);
          }
          sourceKey = resolvedSourceKey.key;
          guidance = resolvedSourceKey.guidance !== undefined ? [resolvedSourceKey.guidance] : [];
        }

        const addOpts: Parameters<typeof addNode>[3] = {};
        if (input.opts?.key !== undefined) addOpts.key = input.opts.key;
        if (input.opts?.label !== undefined) addOpts.label = input.opts.label;
        if (input.opts?.position !== undefined) addOpts.position = input.opts.position;
        if (input.opts?.group_key !== undefined) addOpts.groupKey = input.opts.group_key;
        if (validatedPassthrough !== undefined) addOpts.passthrough = validatedPassthrough;
        if (sourceKey !== undefined) addOpts.sourceNodeKey = sourceKey;
        if (input.opts?.source_output_port !== undefined) {
          addOpts.sourceOutputPort = input.opts.source_output_port;
        }

        const {
          spec: nextSpec,
          newNodeKey,
          wired,
          kind,
        } = addNode(priorSpec, tabId, input.type, addOpts);
        return { nextSpec, extras: { tabId, newNodeKey, wired, kind, typeHadSchema, guidance } };
      },
      (base, extras) => {
        const newNodeId =
          extras.kind === 'config'
            ? findNewConfigNodeId(base.compiledFlows, extras.newNodeKey)
            : findNewNodeId(base.compiledFlows, extras.tabId, extras.newNodeKey);
        return attachNodeKeyResolutionGuidance(
          {
            ok: base.ok,
            staged_hash: base.staged_hash,
            based_on_snapshot_hash: base.based_on_snapshot_hash,
            based_on_rev: base.based_on_rev,
            diff_summary: base.diff_summary,
            type_had_schema: extras.typeHadSchema,
            diagnostics: [...base.diagnostics],
            render: base.render,
            ...(newNodeId !== undefined ? { added_node_id: newNodeId } : {}),
            ...(extras.wired && newNodeId !== undefined && input.opts?.source_node_id !== undefined
              ? {
                  added_wire: {
                    from: input.opts.source_node_id,
                    output_port: input.opts.source_output_port ?? 0,
                    to: newNodeId,
                  },
                }
              : {}),
          },
          extras.guidance,
        );
      },
    ),
};

function rejectCredentialsPassthrough(
  type: string,
  passthrough: Record<string, unknown> | undefined,
): void {
  if (passthrough === undefined) return;
  if (!Object.prototype.hasOwnProperty.call(passthrough, 'credentials')) return;
  throw new ValidationFailedError(
    `passthrough for type '${type}' includes 'credentials'. FlowOtter credentials are not authored; omit the credentials key and fill credential fields in the Node-RED editor after deploy.`,
    [],
  );
}
