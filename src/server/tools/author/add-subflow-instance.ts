import { z } from 'zod';

import { addSubflowInstance } from '../../../toolkit/authoring/operations/add-subflow-instance.js';
import type { TabEnvEntry } from '../../../toolkit/authoring/types.js';
import { type Tool, ValidationFailedError } from '../_tool.js';
import { getOrProbeRuntimeInfo } from '../../runtime-info.js';

import {
  findNewNodeId,
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const EnvEntrySchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(['str', 'num', 'bool', 'json', 'env', 'cred', 'jsonata', 'conf-type']),
    value: z.unknown().optional(),
    ui: z.record(z.unknown()).optional(),
  })
  .strict();

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    defId: z.string().min(1, 'defId is required'),
    opts: z
      .object({
        label: z.string().max(24).optional(),
        key: z.string().min(1).optional(),
        passthrough: z.record(z.unknown()).optional(),
        env: z.array(EnvEntrySchema).optional(),
        group_key: z.string().min(1).optional(),
      })
      .optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;
type EnvInput = NonNullable<NonNullable<Input['opts']>['env']>[number];

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
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const addSubflowInstanceTool: Tool<Input, Output> = {
  name: 'add_subflow_instance',
  description: withStagedAuthorToolDescription(
    'Stages a new subflow instance on the given tab. Optional opts.env supplies per-instance env overrides; conf-type values are config-node authoring keys and require the runtime subflowPerInstanceConfig capability when a runtime is connected. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      defId: { type: 'string', minLength: 1 },
      opts: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 24 },
          key: { type: 'string', minLength: 1 },
          passthrough: { type: 'object', additionalProperties: true },
          env: {
            type: 'array',
            description:
              'Per-instance subflow env overrides. Entries are {name,type,value?,ui?}; for type conf-type, value is a config-node authoring key.',
            items: envEntryJsonSchema(),
          },
          group_key: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    required: ['tab_id', 'defId'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ tabId: string; newNodeKey: string }, Output>(
      ctx,
      { toolName: 'add_subflow_instance' },
      async (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        if (hasConfTypeEnv(input.opts?.env)) {
          const probe = await getOrProbeRuntimeInfo(ctx.container, ctx.clock);
          if (probe.info?.capabilities.subflowPerInstanceConfig === false) {
            throw new ValidationFailedError(
              `opts.env contains conf-type per-instance subflow config, but this target lacks subflowPerInstanceConfig (requires Node-RED >=4.0.0).`,
              [
                {
                  rule: 'capability/subflowPerInstanceConfig',
                  capability: 'subflowPerInstanceConfig',
                  required: '>=4.0.0',
                  actual: probe.info.version,
                },
              ],
            );
          }
        }
        const opts: Parameters<typeof addSubflowInstance>[3] = {};
        if (input.opts?.label !== undefined) opts.label = input.opts.label;
        if (input.opts?.key !== undefined) opts.key = input.opts.key;
        if (input.opts?.passthrough !== undefined) opts.passthrough = input.opts.passthrough;
        if (input.opts?.env !== undefined) opts.env = normalizeEnvEntries(input.opts.env);
        if (input.opts?.group_key !== undefined) opts.groupKey = input.opts.group_key;
        const { spec: nextSpec, newNodeKey } = addSubflowInstance(
          priorSpec,
          tabId,
          input.defId,
          opts,
        );
        return { nextSpec, extras: { tabId, newNodeKey } };
      },
      (base, extras) => {
        const newNodeId = findNewNodeId(base.compiledFlows, extras.tabId, extras.newNodeKey);
        return {
          ok: base.ok,
          staged_hash: base.staged_hash,
          based_on_snapshot_hash: base.based_on_snapshot_hash,
          based_on_rev: base.based_on_rev,
          diff_summary: base.diff_summary,
          diagnostics: [...base.diagnostics],
          render: base.render,
          ...(newNodeId !== undefined ? { added_node_id: newNodeId } : {}),
        };
      },
    ),
};

function hasConfTypeEnv(env: readonly EnvInput[] | undefined): boolean {
  return env?.some((entry) => entry.type === 'conf-type') === true;
}

function normalizeEnvEntries(env: readonly EnvInput[]): readonly TabEnvEntry[] {
  return env.map((entry) => ({
    name: entry.name,
    type: entry.type,
    ...(entry.value !== undefined ? { value: entry.value } : {}),
    ...(entry.ui !== undefined ? { ui: entry.ui } : {}),
  }));
}

function envEntryJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      type: {
        type: 'string',
        enum: ['str', 'num', 'bool', 'json', 'env', 'cred', 'jsonata', 'conf-type'],
      },
      value: {},
      ui: { type: 'object', additionalProperties: true },
    },
    required: ['name', 'type'],
    additionalProperties: false,
  };
}
