import {
  isComment,
  isGroup,
  isRegularNode,
  isSubflowDef,
  isSubflowInstance,
  isTab,
  type FlowsJson,
  type FlowsJsonNode,
} from '../../shared/flows-json.js';
import type { NamingContract } from '../naming/schema.js';
import { runValidators, type ValidationReport } from '../validate/index.js';
import { buildReport } from '../validate/report.js';

export interface FlowStructuralReport {
  readonly tabId: string;
  readonly tabLabel: string;
  readonly disabled: boolean;
  readonly counts: {
    readonly nodes: number;
    readonly groups: number;
    readonly comments: number;
    readonly wires: number;
    readonly subflowInstances: number;
  };
  readonly typeHistogram: Readonly<Record<string, number>>;
  readonly linkSummary: {
    readonly linkIns: number;
    readonly linkOuts: number;
    readonly linkCalls: number;
  };
  readonly dashboardWidgets: number;
  readonly orphans: readonly string[];
  readonly validation: ValidationReport;
}

export interface AllFlowsStructuralReport {
  readonly totals: {
    readonly tabs: number;
    readonly nodes: number;
    readonly subflowDefs: number;
    readonly subflowInstances: number;
    readonly groups: number;
    readonly comments: number;
    readonly wires: number;
  };
  readonly typeHistogram: Readonly<Record<string, number>>;
  readonly perTab: readonly FlowStructuralReport[];
  readonly validation: ValidationReport;
}

export interface AnalyzeOptions {
  readonly labelCap?: number;
  readonly namingContract?: NamingContract;
}

function tabIdOf(node: FlowsJsonNode): string | undefined {
  const z = (node as { z?: unknown }).z;
  return typeof z === 'string' ? z : undefined;
}

function countWires(nodes: FlowsJsonNode[]): number {
  let total = 0;
  for (const n of nodes) {
    if (!isRegularNode(n)) continue;
    const wires = n.wires ?? [];
    for (const arr of wires) total += arr.length;
  }
  return total;
}

function bumpHistogram(histogram: Map<string, number>, type: string): void {
  histogram.set(type, (histogram.get(type) ?? 0) + 1);
}

const DASHBOARD_NON_WIDGET_TYPES = new Set([
  'ui_base',
  'ui_page',
  'ui_group',
  'ui-base',
  'ui-page',
  'ui-group',
  'ui_theme',
  'ui-theme',
  'ui_tab',
  'ui-link',
  'ui-link-group',
]);

function isDashboardWidget(type: string): boolean {
  return (
    (type.startsWith('ui_') || type.startsWith('ui-')) && !DASHBOARD_NON_WIDGET_TYPES.has(type)
  );
}

function findOrphans(nodes: FlowsJsonNode[]): string[] {
  const incoming = new Map<string, number>();
  for (const n of nodes) incoming.set(n.id, 0);
  for (const n of nodes) {
    if (!isRegularNode(n)) continue;
    const wires = n.wires ?? [];
    for (const arr of wires) {
      for (const id of arr) {
        if (incoming.has(id)) incoming.set(id, (incoming.get(id) ?? 0) + 1);
      }
    }
  }
  const orphans: string[] = [];
  for (const n of nodes) {
    if (isDashboardWidget(n.type)) continue;
    const inn = incoming.get(n.id) ?? 0;
    const outn = isRegularNode(n) ? (n.wires ?? []).reduce((s, a) => s + a.length, 0) : 0;
    if (inn === 0 && outn === 0) orphans.push(n.id);
  }
  return orphans;
}

function filterValidationForTab(
  flows: FlowsJson,
  tabId: string,
  validation: ValidationReport,
): ValidationReport {
  const nodeIds = new Set<string>([tabId]);
  for (const n of flows) {
    if (tabIdOf(n) === tabId) nodeIds.add(n.id);
  }

  return buildReport(
    validation.diagnostics.filter((d) => {
      if (d.tabId !== undefined) return d.tabId === tabId;
      if (d.nodeId !== undefined) return nodeIds.has(d.nodeId);
      return false;
    }),
  );
}

export function analyzeFlow(
  flows: FlowsJson,
  tabId: string,
  opts: AnalyzeOptions = {},
): FlowStructuralReport {
  const tab = flows.find((n) => isTab(n) && n.id === tabId);
  if (!tab || !isTab(tab)) {
    throw new Error(`Tab '${tabId}' not found.`);
  }

  const tabNodes: FlowsJsonNode[] = [];
  const groups: FlowsJsonNode[] = [];
  const comments: FlowsJsonNode[] = [];
  const subflowInstances: FlowsJsonNode[] = [];
  const histogram = new Map<string, number>();
  let dashboardWidgets = 0;
  let linkIns = 0;
  let linkOuts = 0;
  let linkCalls = 0;

  for (const n of flows) {
    if (tabIdOf(n) !== tabId) continue;
    if (isGroup(n)) {
      groups.push(n);
      continue;
    }
    if (isComment(n)) {
      comments.push(n);
      continue;
    }
    tabNodes.push(n);
    bumpHistogram(histogram, n.type);
    if (isSubflowInstance(n)) subflowInstances.push(n);
    if (isDashboardWidget(n.type)) dashboardWidgets++;
    if (n.type === 'link in') linkIns++;
    if (n.type === 'link out') linkOuts++;
    if (n.type === 'link call') linkCalls++;
  }

  const wires = countWires(tabNodes);
  const orphans = findOrphans(tabNodes);
  const validateOpts: { labelCap?: number; namingContract?: NamingContract } = {};
  if (opts.labelCap !== undefined) validateOpts.labelCap = opts.labelCap;
  if (opts.namingContract !== undefined) validateOpts.namingContract = opts.namingContract;
  const validation = filterValidationForTab(flows, tabId, runValidators(flows, validateOpts));

  return {
    tabId,
    tabLabel: tab.label,
    disabled: tab.disabled === true,
    counts: {
      nodes: tabNodes.length,
      groups: groups.length,
      comments: comments.length,
      wires,
      subflowInstances: subflowInstances.length,
    },
    typeHistogram: Object.fromEntries(histogram),
    linkSummary: { linkIns, linkOuts, linkCalls },
    dashboardWidgets,
    orphans,
    validation,
  };
}

export function analyzeAllFlows(
  flows: FlowsJson,
  opts: AnalyzeOptions = {},
): AllFlowsStructuralReport {
  const tabs = flows.filter(isTab);
  const histogram = new Map<string, number>();
  let totalNodes = 0;
  let totalGroups = 0;
  let totalComments = 0;
  let totalSubflowDefs = 0;
  let totalSubflowInstances = 0;

  for (const n of flows) {
    if (isTab(n)) continue;
    if (isGroup(n)) {
      totalGroups++;
      continue;
    }
    if (isComment(n)) {
      totalComments++;
      continue;
    }
    if (isSubflowDef(n)) {
      totalSubflowDefs++;
      continue;
    }
    totalNodes++;
    bumpHistogram(histogram, n.type);
    if (isSubflowInstance(n)) totalSubflowInstances++;
  }

  const totalWires = countWires(
    flows.filter((n) => !isTab(n) && !isGroup(n) && !isComment(n) && !isSubflowDef(n)),
  );

  const perTab: FlowStructuralReport[] = tabs.map((t) => analyzeFlow(flows, t.id, opts));

  const validateOpts: { labelCap?: number; namingContract?: NamingContract } = {};
  if (opts.labelCap !== undefined) validateOpts.labelCap = opts.labelCap;
  if (opts.namingContract !== undefined) validateOpts.namingContract = opts.namingContract;
  const validation = runValidators(flows, validateOpts);

  return {
    totals: {
      tabs: tabs.length,
      nodes: totalNodes,
      subflowDefs: totalSubflowDefs,
      subflowInstances: totalSubflowInstances,
      groups: totalGroups,
      comments: totalComments,
      wires: totalWires,
    },
    typeHistogram: Object.fromEntries(histogram),
    perTab,
    validation,
  };
}
