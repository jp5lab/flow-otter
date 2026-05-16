import { z } from 'zod';

import type { FlowsJson } from '../../../shared/flows-json.js';
import { addGroup } from '../../../toolkit/authoring/operations/add-group.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { resolveTabId, runStagedAuthorOp } from './_stage-pipeline.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    name: z.string().min(1, 'name is required').max(24),
    node_keys: z.array(z.string().min(1)).optional(),
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
});
type Output = z.infer<typeof OutputSchema>;

export const addGroupTool: Tool<Input, Output> = {
  name: 'add_group',
  description:
    'Stages a new group on the given tab. Validates and lints the result; produces a semantic diff. Does NOT deploy — call `deploy_staged_change` to push to the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 24 },
      node_keys: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      style: { type: 'object', additionalProperties: true },
    },
    required: ['tab_id', 'name'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ tabId: string; newGroupKey: string }, Output>(
      ctx,
      { toolName: 'add_group' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const opts: Parameters<typeof addGroup>[2] = { name: input.name };
        if (input.node_keys !== undefined) opts.nodeKeys = input.node_keys;
        if (input.style !== undefined) opts.style = input.style;
        const { spec: nextSpec, newGroupKey } = addGroup(priorSpec, tabId, opts);
        return { nextSpec, extras: { tabId, newGroupKey } };
      },
      (base, extras) => {
        const newGroupId = findNewGroupId(base.compiledFlows, extras.tabId, extras.newGroupKey);
        return {
          ok: base.ok,
          staged_hash: base.staged_hash,
          based_on_snapshot_hash: base.based_on_snapshot_hash,
          based_on_rev: base.based_on_rev,
          diff_summary: base.diff_summary,
          diagnostics: [...base.diagnostics],
          ...(newGroupId !== undefined ? { added_group_id: newGroupId } : {}),
        };
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
