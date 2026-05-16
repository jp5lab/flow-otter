import type { FlowsJson, FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Diagnostic } from '../report.js';

export const RULE = 'dashboard-2-group-width-fits';

const UI_GROUP = 'ui-group';
const DEFAULT_GROUP_WIDTH = 6;
const DEFAULT_WIDGET_WIDTH = 'auto';

const STRUCTURAL_OR_INVISIBLE = new Set<string>([
  'ui-base',
  'ui-page',
  'ui-group',
  'ui-theme',
  'ui-link',
  'ui-control',
  'ui-event',
]);

function isV2Widget(type: string): boolean {
  return type.startsWith('ui-') && !STRUCTURAL_OR_INVISIBLE.has(type);
}

function tabId(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function readWidth(node: FlowsJsonNode): number | typeof DEFAULT_WIDGET_WIDTH {
  const v = (node as { width?: unknown }).width;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    if (v === 'auto') return 'auto';
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULT_WIDGET_WIDTH;
}

function readOrder(node: FlowsJsonNode): number {
  const v = (node as { order?: unknown }).order;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return Number.POSITIVE_INFINITY;
}

function readGroupWidth(group: FlowsJsonNode): number {
  const v = (group as { width?: unknown }).width;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULT_GROUP_WIDTH;
}

function readGroupRef(widget: FlowsJsonNode): string | undefined {
  const v = (widget as { group?: unknown }).group;
  return typeof v === 'string' ? v : undefined;
}

export function check(flows: FlowsJson): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const groupWidthById = new Map<string, number>();
  for (const node of flows) {
    if (node.type === UI_GROUP) {
      groupWidthById.set(node.id, readGroupWidth(node));
    }
  }

  if (groupWidthById.size === 0) return diagnostics;

  // Cluster widgets by their parent group.
  const widgetsByGroup = new Map<string, FlowsJsonNode[]>();
  for (const node of flows) {
    if (typeof node.type !== 'string' || !isV2Widget(node.type)) continue;
    const ref = readGroupRef(node);
    if (ref === undefined || !groupWidthById.has(ref)) continue;
    const list = widgetsByGroup.get(ref) ?? [];
    list.push(node);
    widgetsByGroup.set(ref, list);
  }

  for (const [groupId, widgets] of widgetsByGroup) {
    const groupWidth = groupWidthById.get(groupId);
    if (groupWidth === undefined) continue;

    // Per-widget overflow (widget.width > group.width).
    for (const widget of widgets) {
      const w = readWidth(widget);
      if (typeof w !== 'number') continue;
      if (w > groupWidth) {
        const z = tabId(widget);
        diagnostics.push({
          severity: 'error',
          rule: RULE,
          message: `Dashboard 2.0 widget '${widget.id}' (${widget.type}) width=${w} exceeds parent ui-group '${groupId}' width=${groupWidth}.`,
          nodeId: widget.id,
          ...(z !== undefined ? { tabId: z } : {}),
          context: { groupId, widgetWidth: w, groupWidth },
        });
      }
    }

    // Per-row overflow: group widgets are laid out in `order`, wrapping at group.width.
    // Sum widget widths greedily; flag rows whose total exceeds group.width.
    const sorted = widgets
      .filter((w) => typeof readWidth(w) === 'number')
      .sort((a, b) => {
        const oa = readOrder(a);
        const ob = readOrder(b);
        if (oa !== ob) return oa - ob;
        return a.id.localeCompare(b.id);
      });

    let row = 0;
    let rowSum = 0;
    let rowMembers: FlowsJsonNode[] = [];
    const flushRow = (): void => {
      if (rowSum > groupWidth) {
        for (const m of rowMembers) {
          const z = tabId(m);
          diagnostics.push({
            severity: 'error',
            rule: RULE,
            message: `Dashboard 2.0 row ${row} in ui-group '${groupId}' totals ${rowSum} cols, exceeding group width ${groupWidth}.`,
            nodeId: m.id,
            ...(z !== undefined ? { tabId: z } : {}),
            context: { groupId, row, rowSum, groupWidth },
          });
        }
      }
    };
    for (const widget of sorted) {
      const w = readWidth(widget) as number;
      if (rowSum + w > groupWidth && rowMembers.length > 0) {
        flushRow();
        row += 1;
        rowSum = 0;
        rowMembers = [];
      }
      rowSum += w;
      rowMembers.push(widget);
    }
    flushRow();
  }

  return diagnostics;
}
