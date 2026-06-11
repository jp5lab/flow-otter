import { z } from 'zod';

import type { FlowsJson } from '../../../shared/flows-json.js';
import { addDashboardWidget } from '../../../toolkit/authoring/operations/add-dashboard-widget.js';
import {
  getWidgetAnchorRequirement,
  getWidgetSchema,
  knownWidgetTypes,
} from '../../../toolkit/authoring/widget-schemas.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { resolveTabId, runStagedAuthorOp } from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1).optional(),
    widget_type: z.string().min(1, 'widget_type is required'),
    opts: z
      .object({
        key: z.string().min(1).optional(),
        label: z.string().max(64).optional(),
        position: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
        group_key: z.string().min(1).optional(),
        page_key: z.string().min(1).optional(),
        ui_key: z.string().min(1).optional(),
        passthrough: z.record(z.unknown()).optional(),
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
  widget_type: z.string(),
  widget_id: z.string().optional(),
  appended_config_node: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const addDashboardWidgetTool: Tool<Input, Output> = {
  name: 'add_dashboard_widget',
  description:
    'Stages a new Dashboard 2.0 widget. Pass `widget_type` (one of ui-dropdown / ui-radio-group / ui-slider / ui-switch / ui-text-input / ui-number-input / ui-file-input / ui-markdown / ui-progress / ui-audio / ui-spacer / ui-event / ui-link / ui-group-dialog). `opts.group_key` is required for most widgets (call instantiate_template dashboard_2_skeleton first to get one). `opts.ui_key` for ui-link. `opts.page_key` for ui-group-dialog. Validates passthrough against per-widget Zod. Does NOT deploy.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['widget_type'],
    properties: {
      tab_id: {
        type: 'string',
        minLength: 1,
        description:
          'Tab to add the widget to. Required for all widgets except ui-group-dialog (which appends a config-node, not a tab node).',
      },
      widget_type: {
        type: 'string',
        enum: knownWidgetTypes() as string[],
        description: 'Dashboard 2.0 widget type. 14 types supported in v0.6.0.',
      },
      opts: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', minLength: 1 },
          label: { type: 'string', maxLength: 64 },
          position: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          },
          group_key: {
            type: 'string',
            minLength: 1,
            description: 'ui-group authoring key. Required for most widgets.',
          },
          page_key: {
            type: 'string',
            minLength: 1,
            description: 'ui-page authoring key. Used by ui-group-dialog.',
          },
          ui_key: {
            type: 'string',
            minLength: 1,
            description: 'ui-base authoring key. Used by ui-link.',
          },
          passthrough: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<
      { newWidgetKey: string; appendedConfigNode: boolean; tabId: string | undefined },
      Output
    >(
      ctx,
      { toolName: 'add_dashboard_widget', reason: `add_dashboard_widget:${input.widget_type}` },
      (priorSpec, priorFlows) => {
        const widgetType = input.widget_type;
        const schema = getWidgetSchema(widgetType);
        if (!schema) {
          throw new ValidationFailedError(
            `widget_type '${widgetType}' is not a known Dashboard 2.0 widget. Known: ${knownWidgetTypes().join(', ')}.`,
            [],
          );
        }
        const anchorReq = getWidgetAnchorRequirement(widgetType);
        if (anchorReq === undefined) {
          throw new ValidationFailedError(
            `widget_type '${widgetType}' has no anchor-requirement entry.`,
            [],
          );
        }

        // Validate anchor presence per widget requirement.
        if (anchorReq === 'group' && !input.opts?.group_key) {
          throw new ValidationFailedError(
            `Widget '${widgetType}' requires opts.group_key (an existing ui-group authoring key).`,
            [],
          );
        }
        if (anchorReq === 'ui' && !input.opts?.ui_key) {
          throw new ValidationFailedError(
            `Widget '${widgetType}' requires opts.ui_key (an existing ui-base authoring key).`,
            [],
          );
        }
        if (anchorReq === 'config' && !input.opts?.page_key) {
          throw new ValidationFailedError(
            `Widget '${widgetType}' requires opts.page_key (an existing ui-page authoring key).`,
            [],
          );
        }

        // Validate passthrough against per-widget schema if supplied.
        let validatedPassthrough: Record<string, unknown> | undefined = input.opts?.passthrough;
        if (input.opts?.passthrough !== undefined) {
          const parseResult = schema.safeParse(input.opts.passthrough);
          if (!parseResult.success) {
            const issues = parseResult.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ');
            throw new ValidationFailedError(
              `passthrough for widget '${widgetType}' failed schema validation: ${issues}`,
              parseResult.error.issues,
            );
          }
          validatedPassthrough = parseResult.data as Record<string, unknown>;
        }

        // Resolve tab id (config-only widgets — ui-group-dialog — don't need one).
        let tabId: string | undefined;
        if (anchorReq !== 'config') {
          if (!input.tab_id) {
            throw new ValidationFailedError(`Widget '${widgetType}' requires tab_id.`, []);
          }
          tabId = resolveTabId(priorFlows, input.tab_id);
          if (!tabId) {
            throw new ValidationFailedError(
              `Tab '${input.tab_id}' not found in current flows.`,
              [],
            );
          }
        }

        const addOpts: Parameters<typeof addDashboardWidget>[3] = {};
        if (input.opts?.key !== undefined) addOpts.key = input.opts.key;
        if (input.opts?.label !== undefined) addOpts.label = input.opts.label;
        if (input.opts?.position !== undefined) addOpts.position = input.opts.position;
        if (input.opts?.group_key !== undefined) addOpts.groupKey = input.opts.group_key;
        if (input.opts?.page_key !== undefined) addOpts.pageKey = input.opts.page_key;
        if (input.opts?.ui_key !== undefined) addOpts.uiKey = input.opts.ui_key;
        if (validatedPassthrough !== undefined) addOpts.passthrough = validatedPassthrough;

        const {
          spec: nextSpec,
          newWidgetKey,
          appendedConfigNode,
        } = addDashboardWidget(priorSpec, tabId, widgetType, addOpts);
        return { nextSpec, extras: { newWidgetKey, appendedConfigNode, tabId } };
      },
      (base, extras) => {
        const newWidgetId = extras.appendedConfigNode
          ? findNewConfigNodeId(base.compiledFlows, extras.newWidgetKey)
          : extras.tabId !== undefined
            ? findNewWidgetId(base.compiledFlows, extras.tabId, extras.newWidgetKey)
            : undefined;
        return {
          ok: base.ok,
          staged_hash: base.staged_hash,
          based_on_snapshot_hash: base.based_on_snapshot_hash,
          based_on_rev: base.based_on_rev,
          diff_summary: base.diff_summary,
          widget_type: input.widget_type,
          appended_config_node: extras.appendedConfigNode,
          diagnostics: [...base.diagnostics],
          render: base.render,
          ...(newWidgetId !== undefined ? { widget_id: newWidgetId } : {}),
        };
      },
    ),
};

function findNewWidgetId(flows: FlowsJson, tabId: string, newKey: string): string | undefined {
  for (const n of flows) {
    if ((n as { z?: string }).z !== tabId) continue;
    const ext = (n as Record<string, unknown>)['_authoringKey'];
    if (ext === newKey) return n.id;
  }
  return undefined;
}

function findNewConfigNodeId(flows: FlowsJson, newKey: string): string | undefined {
  for (const n of flows) {
    if ((n as { z?: string }).z !== undefined) continue;
    const ext = (n as Record<string, unknown>)['_authoringKey'];
    if (ext === newKey) return n.id;
  }
  return undefined;
}
