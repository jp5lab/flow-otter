import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'dashboard-hierarchy';

const UI_BASE_V1 = 'ui_base';
const UI_PAGE_V1 = 'ui_page';
const UI_GROUP_V1 = 'ui_group';
const UI_BASE_V2 = 'ui-base';
const UI_PAGE_V2 = 'ui-page';
const UI_GROUP_V2 = 'ui-group';

const UI_BASE_TYPES = new Set([UI_BASE_V1, UI_BASE_V2]);
const UI_PAGE_TYPES = new Set([UI_PAGE_V1, UI_PAGE_V2]);
const UI_GROUP_TYPES = new Set([UI_GROUP_V1, UI_GROUP_V2]);
const UI_NON_WIDGET_TYPES = new Set([
  UI_BASE_V1,
  UI_PAGE_V1,
  UI_GROUP_V1,
  UI_BASE_V2,
  UI_PAGE_V2,
  UI_GROUP_V2,
  'ui_theme',
  'ui-theme',
  'ui_tab',
  'ui-link',
  'ui-link-group',
]);

function isWidgetType(type: string): boolean {
  return (type.startsWith('ui_') || type.startsWith('ui-')) && !UI_NON_WIDGET_TYPES.has(type);
}

function expectedBaseType(node: FlowsJsonNode): string {
  return node.type === UI_PAGE_V2 ? UI_BASE_V2 : UI_BASE_V1;
}

function expectedPageType(node: FlowsJsonNode): string {
  return node.type === UI_GROUP_V2 ? UI_PAGE_V2 : UI_PAGE_V1;
}

function expectedGroupType(node: FlowsJsonNode): string {
  return node.type.startsWith('ui-') ? UI_GROUP_V2 : UI_GROUP_V1;
}

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function refField(node: FlowsJsonNode, name: string): string | undefined {
  const v = (node as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : undefined;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const uiBaseIds = new Set<string>();
  const uiPageIds = new Set<string>();
  const uiGroupIds = new Set<string>();
  const pages: FlowsJsonNode[] = [];
  const groups: FlowsJsonNode[] = [];
  const widgets: FlowsJsonNode[] = [];

  for (const node of flows) {
    if (typeof node.type !== 'string') continue;
    if (UI_BASE_TYPES.has(node.type)) {
      uiBaseIds.add(node.id);
    } else if (UI_PAGE_TYPES.has(node.type)) {
      uiPageIds.add(node.id);
      pages.push(node);
    } else if (UI_GROUP_TYPES.has(node.type)) {
      uiGroupIds.add(node.id);
      groups.push(node);
    } else if (isWidgetType(node.type)) {
      widgets.push(node);
    }
  }

  if (
    uiBaseIds.size === 0 &&
    uiPageIds.size === 0 &&
    uiGroupIds.size === 0 &&
    widgets.length === 0
  ) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const page of pages) {
    const ref = refField(page, 'ui');
    if (ref === undefined) continue;
    if (!uiBaseIds.has(ref)) {
      const z = tabId(page);
      const expected = expectedBaseType(page);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Dashboard ${page.type} '${page.id}' references missing ${expected} '${ref}'.`,
        nodeId: page.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { expected, actual: ref, parent: 'ui_page' },
      });
    }
  }

  for (const group of groups) {
    const ref = refField(group, 'page');
    if (ref === undefined) continue;
    if (!uiPageIds.has(ref)) {
      const z = tabId(group);
      const expected = expectedPageType(group);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Dashboard ${group.type} '${group.id}' references missing ${expected} '${ref}'.`,
        nodeId: group.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { expected, actual: ref, parent: 'ui_group' },
      });
    }
  }

  for (const widget of widgets) {
    const ref = refField(widget, 'group');
    if (ref === undefined) continue;
    if (!uiGroupIds.has(ref)) {
      const z = tabId(widget);
      const expected = expectedGroupType(widget);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Dashboard widget '${widget.id}' (${widget.type}) references missing ${expected} '${ref}'.`,
        nodeId: widget.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { expected, actual: ref, parent: 'ui_widget' },
      });
    }
  }

  return diagnostics;
}
