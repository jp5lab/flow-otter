/**
 * Operator-screen clutter limit: when an operator screen has too many
 * widgets in one group or too many groups on one page, scanning becomes
 * slow and decisions degrade. The thresholds (12 widgets / group, 6
 * groups / page) come from typical operator-screen design guidance and
 * can be tuned with the rule's options.
 */

import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'screen-clutter';

export const DEFAULT_WIDGETS_PER_GROUP = 12;
export const DEFAULT_GROUPS_PER_PAGE = 6;

export interface ScreenClutterOptions {
  widgetsPerGroup?: number;
  groupsPerPage?: number;
}

function tabIdOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function isDashboard2Widget(type: string): boolean {
  // Dashboard 2.0 widgets are prefixed `ui-`. Exclude config-node types
  // (ui-base / ui-page / ui-group / ui-theme) and the layout/control helpers.
  if (!type.startsWith('ui-')) return false;
  return type !== 'ui-base' && type !== 'ui-page' && type !== 'ui-group' && type !== 'ui-theme';
}

export function check(flows: FlowsJson, opts: ScreenClutterOptions = {}): Diagnostic[] {
  const widgetCap = opts.widgetsPerGroup ?? DEFAULT_WIDGETS_PER_GROUP;
  const groupCap = opts.groupsPerPage ?? DEFAULT_GROUPS_PER_PAGE;

  const widgetsByGroup = new Map<string, number>();
  const groupsByPage = new Map<string, Set<string>>();

  for (const node of flows) {
    const type = typeof node.type === 'string' ? node.type : '';

    // Count widgets per ui-group (via `group` reference on the node).
    if (isDashboard2Widget(type)) {
      const groupId = (node as { group?: unknown }).group;
      if (typeof groupId === 'string') {
        widgetsByGroup.set(groupId, (widgetsByGroup.get(groupId) ?? 0) + 1);
      }
    }

    // Track groups per ui-page (ui-group references a ui-page in its `page` field).
    if (type === 'ui-group') {
      const pageId = (node as { page?: unknown }).page;
      if (typeof pageId === 'string') {
        let set = groupsByPage.get(pageId);
        if (set === undefined) {
          set = new Set();
          groupsByPage.set(pageId, set);
        }
        set.add(node.id);
      }
    }
  }

  const diagnostics: Diagnostic[] = [];

  // Group-level: too many widgets in one group.
  for (const [groupId, count] of widgetsByGroup) {
    if (count <= widgetCap) continue;
    // Locate the group node to attach a tabId.
    const groupNode = flows.find((n) => n.id === groupId);
    diagnostics.push({
      severity: 'warning',
      rule: RULE,
      message: `Dashboard 2.0 ui-group '${groupId}' contains ${count} widgets (>${widgetCap}). Operator screens lose scanability past ~12 widgets per group; split into multiple groups or pages.`,
      nodeId: groupId,
      ...(groupNode !== undefined && tabIdOf(groupNode) !== undefined
        ? { tabId: tabIdOf(groupNode)! }
        : {}),
      context: { count, cap: widgetCap, scope: 'group' },
    });
  }

  // Page-level: too many groups on one page.
  for (const [pageId, groups] of groupsByPage) {
    if (groups.size <= groupCap) continue;
    diagnostics.push({
      severity: 'warning',
      rule: RULE,
      message: `Dashboard 2.0 ui-page '${pageId}' contains ${groups.size} groups (>${groupCap}). Operator-screen cognitive load increases sharply past ~6 groups per page; split into multiple pages.`,
      nodeId: pageId,
      context: { count: groups.size, cap: groupCap, scope: 'page' },
    });
  }

  return diagnostics;
}
