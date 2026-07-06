import { z } from 'zod';

import type { RuntimeNodeDefaults } from '../../../adapters/nodered/capabilities.js';
import { getNodeSchema } from '../../../toolkit/authoring/node-schemas.js';
import { addNode } from '../../../toolkit/authoring/operations/add-node.js';
import { type Tool, ValidationFailedError } from '../_tool.js';
import { getOrProbeRuntimeInfo } from '../../runtime-info.js';

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
        info: z.string().optional(),
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

const DefaultsAppliedFromSchema = z.record(z.enum(['schema', 'settings']));

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
  defaults_applied_from: DefaultsAppliedFromSchema,
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const addNodeTool: Tool<Input, Output> = {
  name: 'add_node',
  description: withStagedAuthorToolDescription(
    'Generic node-add: stages a new node of any Node-RED type on a tab; known config-node types (e.g. "mqtt-broker") are staged globally without canvas fields. Pass `type` (e.g. "change", "switch", "http in"), optional `opts.info` for Node-RED info text, and optional `opts.passthrough` for per-type config. If a per-type Zod schema is registered for the node type, `passthrough` is validated against it; runtime nodeDefaults settings are merged when the target supports nodeDefaultsOverride. Output defaults_applied_from reports schema/settings default sources. Optionally wires from `opts.source_node_id`. Does NOT deploy.',
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
          info: {
            type: 'string',
            description: 'Node info annotation shown in the Node-RED info sidebar.',
          },
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
        defaultsAppliedFrom: Record<string, 'schema' | 'settings'>;
        guidance: readonly NodeKeyResolutionGuidance[];
      },
      Output
    >(
      ctx,
      { toolName: 'add_node', reason: `add_node:${input.type}` },
      async (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        rejectCredentialsPassthrough(input.type, input.opts?.passthrough);

        const probe = await getOrProbeRuntimeInfo(ctx.container, ctx.clock);
        const materialized = materializeNodePassthrough(
          input.type,
          input.opts?.passthrough,
          probe.info?.node_defaults,
        );
        rejectCredentialsPassthrough(input.type, materialized.passthrough);

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
        if (input.opts?.info !== undefined) addOpts.info = input.opts.info;
        if (input.opts?.position !== undefined) addOpts.position = input.opts.position;
        if (input.opts?.group_key !== undefined) addOpts.groupKey = input.opts.group_key;
        if (materialized.passthrough !== undefined) addOpts.passthrough = materialized.passthrough;
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
        return {
          nextSpec,
          extras: {
            tabId,
            newNodeKey,
            wired,
            kind,
            typeHadSchema: materialized.typeHadSchema,
            defaultsAppliedFrom: materialized.defaultsAppliedFrom,
            guidance,
          },
        };
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
            defaults_applied_from: extras.defaultsAppliedFrom,
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

interface MaterializedPassthrough {
  readonly passthrough: Record<string, unknown> | undefined;
  readonly typeHadSchema: boolean;
  readonly defaultsAppliedFrom: Record<string, 'schema' | 'settings'>;
}

function materializeNodePassthrough(
  type: string,
  callerPassthrough: Record<string, unknown> | undefined,
  nodeDefaults: RuntimeNodeDefaults | undefined,
): MaterializedPassthrough {
  const schema = getNodeSchema(type);
  const typeHadSchema = schema !== undefined;
  const settingsDefaults = nodeDefaults?.[type];
  const hasSettingsDefaults =
    settingsDefaults !== undefined && Object.keys(settingsDefaults).length > 0;
  const hasCallerPassthrough = callerPassthrough !== undefined;
  const mergedInput =
    hasSettingsDefaults || hasCallerPassthrough
      ? {
          ...(settingsDefaults ?? {}),
          ...(callerPassthrough ?? {}),
        }
      : undefined;

  let passthrough: Record<string, unknown> | undefined;
  if (schema !== undefined) {
    const parseInput = mergedInput ?? {};
    const parseResult = schema.safeParse(parseInput);
    if (!parseResult.success) {
      if (mergedInput === undefined) {
        return { passthrough: undefined, typeHadSchema, defaultsAppliedFrom: {} };
      }
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new ValidationFailedError(
        `passthrough for type '${type}' failed schema validation: ${issues}`,
        parseResult.error.issues,
      );
    }
    passthrough = parseResult.data as Record<string, unknown>;
  } else {
    passthrough = mergedInput;
  }

  const defaultsAppliedFrom: Record<string, 'schema' | 'settings'> = {};
  if (passthrough !== undefined) {
    for (const key of Object.keys(passthrough)) {
      if (callerPassthrough !== undefined && hasOwn(callerPassthrough, key)) continue;
      if (settingsDefaults !== undefined && hasOwn(settingsDefaults, key)) {
        defaultsAppliedFrom[key] = 'settings';
      } else if (schema !== undefined) {
        defaultsAppliedFrom[key] = 'schema';
      }
    }
  }

  return { passthrough, typeHadSchema, defaultsAppliedFrom };
}

function hasOwn(obj: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

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
