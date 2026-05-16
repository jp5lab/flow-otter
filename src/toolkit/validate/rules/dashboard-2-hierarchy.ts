import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'dashboard-2-hierarchy';

const UI_BASE = 'ui-base';
const UI_PAGE = 'ui-page';
const UI_GROUP = 'ui-group';
const UI_THEME = 'ui-theme';
const UI_LINK = 'ui-link';
const UI_TEMPLATE = 'ui-template';
const UI_CONTROL = 'ui-control';
const UI_EVENT = 'ui-event';

const STRUCTURAL = new Set<string>([UI_BASE, UI_PAGE, UI_GROUP, UI_THEME, UI_LINK]);
const INVISIBLE = new Set<string>([UI_CONTROL, UI_EVENT]);

function isV2Type(type: string): boolean {
  return type.startsWith('ui-');
}

function isV2Widget(type: string): boolean {
  if (!isV2Type(type)) return false;
  if (STRUCTURAL.has(type)) return false;
  if (INVISIBLE.has(type)) return false;
  return true;
}

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function refField(node: FlowsJsonNode, name: string): string | undefined {
  const v = (node as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : undefined;
}

function templateScope(node: FlowsJsonNode): string | undefined {
  const v = (node as { templateScope?: unknown }).templateScope;
  return typeof v === 'string' ? v : undefined;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const baseIds = new Set<string>();
  const pageIds = new Set<string>();
  const groupIds = new Set<string>();
  const pages: FlowsJsonNode[] = [];
  const groups: FlowsJsonNode[] = [];
  const widgets: FlowsJsonNode[] = [];

  for (const node of flows) {
    if (typeof node.type !== 'string') continue;
    if (node.type === UI_BASE) {
      baseIds.add(node.id);
    } else if (node.type === UI_PAGE) {
      pageIds.add(node.id);
      pages.push(node);
    } else if (node.type === UI_GROUP) {
      groupIds.add(node.id);
      groups.push(node);
    } else if (isV2Widget(node.type)) {
      widgets.push(node);
    }
  }

  // No Dashboard 2.0 nodes at all — nothing to validate.
  if (baseIds.size === 0 && pageIds.size === 0 && groupIds.size === 0 && widgets.length === 0) {
    return diagnostics;
  }

  for (const page of pages) {
    const ref = refField(page, 'ui');
    if (ref === undefined) {
      const z = tabId(page);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `ui-page '${page.id}' is missing required 'ui' reference to a ui-base.`,
        nodeId: page.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { missing: 'ui' },
      });
      continue;
    }
    if (!baseIds.has(ref)) {
      const z = tabId(page);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `ui-page '${page.id}' references ui-base '${ref}' that does not exist.`,
        nodeId: page.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { expected: 'ui-base', actual: ref },
      });
    }
  }

  for (const group of groups) {
    const ref = refField(group, 'page');
    if (ref === undefined) {
      const z = tabId(group);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `ui-group '${group.id}' is missing required 'page' reference to a ui-page.`,
        nodeId: group.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { missing: 'page' },
      });
      continue;
    }
    if (!pageIds.has(ref)) {
      const z = tabId(group);
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `ui-group '${group.id}' references ui-page '${ref}' that does not exist.`,
        nodeId: group.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { expected: 'ui-page', actual: ref },
      });
    }
  }

  for (const widget of widgets) {
    const z = tabId(widget);

    if (widget.type === UI_TEMPLATE) {
      const scope = templateScope(widget);
      if (scope === 'widget:ui' || scope === 'site:style') {
        const ref = refField(widget, 'ui');
        if (ref === undefined) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `ui-template '${widget.id}' (templateScope='${scope}') is missing required 'ui' reference to a ui-base.`,
            nodeId: widget.id,
            ...(z !== undefined ? { tabId: z } : {}),
            context: { missing: 'ui', templateScope: scope },
          });
        } else if (!baseIds.has(ref)) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `ui-template '${widget.id}' references ui-base '${ref}' that does not exist.`,
            nodeId: widget.id,
            ...(z !== undefined ? { tabId: z } : {}),
            context: { expected: 'ui-base', actual: ref, templateScope: scope },
          });
        }
        continue;
      }
      if (scope === 'widget:page' || scope === 'page:style') {
        const ref = refField(widget, 'page');
        if (ref === undefined) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `ui-template '${widget.id}' (templateScope='${scope}') is missing required 'page' reference to a ui-page.`,
            nodeId: widget.id,
            ...(z !== undefined ? { tabId: z } : {}),
            context: { missing: 'page', templateScope: scope },
          });
        } else if (!pageIds.has(ref)) {
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `ui-template '${widget.id}' references ui-page '${ref}' that does not exist.`,
            nodeId: widget.id,
            ...(z !== undefined ? { tabId: z } : {}),
            context: { expected: 'ui-page', actual: ref, templateScope: scope },
          });
        }
        continue;
      }
      // Default templateScope (undefined or 'local' / 'widget:group') anchors to a group.
    }

    const ref = refField(widget, 'group');
    if (ref === undefined) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Dashboard 2.0 widget '${widget.id}' (${widget.type}) is missing required 'group' reference to a ui-group.`,
        nodeId: widget.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { missing: 'group' },
      });
      continue;
    }
    if (!groupIds.has(ref)) {
      diagnostics.push({
        severity: 'error',
        rule: RULE,
        message: `Dashboard 2.0 widget '${widget.id}' (${widget.type}) references ui-group '${ref}' that does not exist.`,
        nodeId: widget.id,
        ...(z !== undefined ? { tabId: z } : {}),
        context: { expected: 'ui-group', actual: ref },
      });
    }
  }

  return diagnostics;
}
