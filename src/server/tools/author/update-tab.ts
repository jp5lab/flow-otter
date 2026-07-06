import { z } from 'zod';

import { isTab, type FlowsJson } from '../../../shared/flows-json.js';
import { updateTab } from '../../../toolkit/authoring/operations/update-tab.js';
import type { TabEnvEntry } from '../../../toolkit/authoring/types.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const TabEnvEntrySchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(['str', 'num', 'bool', 'json', 'env', 'cred', 'jsonata', 'conf-type']),
    value: z.unknown().optional(),
    ui: z.record(z.unknown()).optional(),
  })
  .strict();
type EnvInput = z.infer<typeof TabEnvEntrySchema>;

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    label: z.string().min(1).optional(),
    info: z.string().optional(),
    env: z.array(TabEnvEntrySchema).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.label === undefined && input.info === undefined && input.env === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'update_tab requires at least one field: label, info, or env',
      });
    }
    for (const entry of input.env ?? []) {
      if (hasAuthoredCredentialValue(entry)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['env'],
          message:
            `env entry '${entry.name}' has type 'cred' with a non-empty value; ` +
            'FlowOtter credential values are not authored',
        });
      }
    }
  });
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
  updated_tab_id: z.string(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const updateTabTool: Tool<Input, Output> = {
  name: 'update_tab',
  description: withStagedAuthorToolDescription(
    'Stages updates to an existing tab label, tab info, or tab env entries. Passing env replaces the tab env array wholesale; use [] to clear existing tab env entries. Credential-typed env entries may be declared, but FlowOtter rejects credential values. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      label: { type: 'string', minLength: 1 },
      info: { type: 'string' },
      env: {
        type: 'array',
        description:
          'Replacement tab env array. Each entry is {name,type,value?,ui?}; passing [] clears existing entries. For type "cred", omit value.',
        items: {
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
        },
      },
    },
    required: ['tab_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ updated: boolean; tabId: string }, Output>(
      ctx,
      { toolName: 'update_tab' },
      (priorSpec, priorFlows) => {
        validateNoCredentialEnvValues(input.env);
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }

        const opts: Parameters<typeof updateTab>[2] = {};
        if (input.label !== undefined) opts.label = input.label;
        if (input.info !== undefined) opts.info = input.info;
        const env = normalizeEnvEntries(input.env);
        if (env !== undefined) opts.env = env;

        const { spec: nextSpec, updated } = updateTab(priorSpec, tabId, opts);
        return { nextSpec, extras: { updated, tabId } };
      },
      (base, extras) => ({
        ok: base.ok,
        staged_hash: base.staged_hash,
        based_on_snapshot_hash: base.based_on_snapshot_hash,
        based_on_rev: base.based_on_rev,
        diff_summary: base.diff_summary,
        updated: extras.updated,
        updated_tab_id: findTabNodeRedId(base.compiledFlows, extras.tabId) ?? extras.tabId,
        diagnostics: [...base.diagnostics],
        render: base.render,
      }),
    ),
};

function hasAuthoredCredentialValue(entry: Pick<EnvInput, 'type' | 'value'>): boolean {
  if (entry.type !== 'cred') return false;
  if (entry.value === undefined || entry.value === null) return false;
  return !(typeof entry.value === 'string' && entry.value.length === 0);
}

function validateNoCredentialEnvValues(env: readonly EnvInput[] | undefined): void {
  for (const entry of env ?? []) {
    if (!hasAuthoredCredentialValue(entry)) continue;
    throw new ValidationFailedError(
      `env entry '${entry.name}' has type 'cred' with a non-empty value. FlowOtter credential values are not authored; omit value and fill credentials in the Node-RED editor after deploy.`,
      [],
    );
  }
}

function normalizeEnvEntries(
  env: readonly EnvInput[] | undefined,
): readonly TabEnvEntry[] | undefined {
  if (env === undefined) return undefined;
  return env.map((entry) => ({
    name: entry.name,
    type: entry.type,
    ...(entry.value !== undefined ? { value: entry.value } : {}),
    ...(entry.ui !== undefined ? { ui: entry.ui } : {}),
  }));
}

function findTabNodeRedId(flows: FlowsJson, tabKey: string): string | undefined {
  for (const node of flows) {
    if (!isTab(node)) continue;
    const ext = (node as Record<string, unknown>)['_authoringKey'];
    if ((typeof ext === 'string' ? ext : node.id) === tabKey) return node.id;
  }
  return undefined;
}
