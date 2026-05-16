import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'dashboard-2-required-fields';

/**
 * Per-type required fields, sourced from the `required: true` markers in each
 * Dashboard 2.0 node's HTML registration (research doc §3 reference table).
 *
 * `name` is required on every Dashboard 2.0 type. Anchor fields (`group`,
 * `page`, `ui`) are validated by `dashboard-2-hierarchy`; this rule covers
 * the remaining type-specific required fields.
 */
const REQUIRED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'ui-base': ['name', 'path'],
  'ui-page': ['name', 'path', 'ui'],
  'ui-group': ['name', 'page'],
  'ui-theme': ['name'],
  'ui-link': ['name', 'path', 'ui'],
  'ui-button': ['name', 'group'],
  'ui-button-group': ['name', 'group'],
  'ui-dropdown': ['name', 'group'],
  'ui-radio-group': ['name', 'group'],
  'ui-slider': ['name', 'group'],
  'ui-switch': ['name', 'group'],
  'ui-text-input': ['name', 'group'],
  'ui-number-input': ['name', 'group'],
  'ui-form': ['name', 'group', 'options'],
  'ui-file-input': ['name', 'group'],
  'ui-text': ['name', 'group'],
  'ui-markdown': ['name', 'group'],
  'ui-table': ['name', 'group'],
  'ui-chart': ['name', 'group', 'chartType', 'xAxisType'],
  'ui-gauge': ['name', 'group'],
  'ui-progress': ['name', 'group'],
  'ui-audio': ['name', 'group'],
  'ui-notification': ['name', 'group'],
  'ui-spacer': ['name', 'group'],
  // ui-template's anchor depends on templateScope — handled below.
  // ui-control / ui-event have no required fields per the doc.
};

const UI_TEMPLATE = 'ui-template';

function isV2Type(type: string): boolean {
  return type.startsWith('ui-');
}

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function fieldPresent(node: FlowsJsonNode, field: string): boolean {
  const v = (node as Record<string, unknown>)[field];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function templateScope(node: FlowsJsonNode): string | undefined {
  const v = (node as { templateScope?: unknown }).templateScope;
  return typeof v === 'string' ? v : undefined;
}

function templateAnchorField(scope: string | undefined): 'group' | 'page' | 'ui' {
  if (scope === 'widget:ui' || scope === 'site:style') return 'ui';
  if (scope === 'widget:page' || scope === 'page:style') return 'page';
  return 'group';
}

function pushMissing(
  diagnostics: Diagnostic[],
  node: FlowsJsonNode,
  field: string,
  type: string,
): void {
  const z = tabId(node);
  diagnostics.push({
    severity: 'error',
    rule: RULE,
    message: `Dashboard 2.0 node '${node.id}' (${type}) is missing required field '${field}'.`,
    nodeId: node.id,
    ...(z !== undefined ? { tabId: z } : {}),
    context: { type, field },
  });
}

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of flows) {
    if (typeof node.type !== 'string' || !isV2Type(node.type)) continue;

    if (node.type === UI_TEMPLATE) {
      if (!fieldPresent(node, 'name')) pushMissing(diagnostics, node, 'name', node.type);
      const anchor = templateAnchorField(templateScope(node));
      if (!fieldPresent(node, anchor)) pushMissing(diagnostics, node, anchor, node.type);
      if (!fieldPresent(node, 'format')) pushMissing(diagnostics, node, 'format', node.type);
      continue;
    }

    const required = REQUIRED_FIELDS[node.type];
    if (required === undefined) continue;
    for (const field of required) {
      if (!fieldPresent(node, field)) {
        pushMissing(diagnostics, node, field, node.type);
      }
    }
  }

  return diagnostics;
}
