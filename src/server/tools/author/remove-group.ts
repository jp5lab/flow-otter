import { z } from 'zod';

import { isGroup, isTab, type FlowsJson } from '../../../shared/flows-json.js';
import { removeGroup } from '../../../toolkit/authoring/operations/remove-group.js';
import type { AuthoringSpec } from '../../../toolkit/authoring/types.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import {
  resolveTabId,
  runStagedAuthorOp,
  withStagedAuthorToolDescription,
} from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1, 'tab_id is required'),
    group_key: z.string().min(1, 'group_key is required'),
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
  removed: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const removeGroupTool: Tool<Input, Output> = {
  name: 'remove_group',
  description: withStagedAuthorToolDescription(
    'Stages removal of a visual group using Node-RED ungroup semantics: member nodes, junctions, comments, and child groups are never deleted; they reparent to the removed group parent or become top-level. Does NOT deploy.',
  ),
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      group_key: { type: 'string', minLength: 1 },
    },
    required: ['tab_id', 'group_key'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<{ removed: boolean }, Output>(
      ctx,
      { toolName: 'remove_group' },
      (priorSpec, priorFlows) => {
        const tabId = resolveTabId(priorFlows, input.tab_id);
        if (!tabId) {
          throw new ValidationFailedError(`Tab '${input.tab_id}' not found in current flows.`, []);
        }
        const groupKey = resolveGroupKeyOnTab(priorSpec, priorFlows, tabId, input.group_key);
        const { spec: nextSpec, removed } = removeGroup(priorSpec, tabId, groupKey);
        return { nextSpec, extras: { removed } };
      },
      (base, extras) => ({
        ok: base.ok,
        staged_hash: base.staged_hash,
        based_on_snapshot_hash: base.based_on_snapshot_hash,
        based_on_rev: base.based_on_rev,
        diff_summary: base.diff_summary,
        removed: extras.removed,
        diagnostics: [...base.diagnostics],
        render: base.render,
      }),
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
