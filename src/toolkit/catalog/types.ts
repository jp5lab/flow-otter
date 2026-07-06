/**
 * Capability catalog — structured inventory of FlowOtter's surface area so the
 * agent (and via the agent, the user) can discover what's possible without
 * trial-and-error against tool descriptions alone.
 *
 * The catalog covers: Node-RED concepts, core node types, Dashboard 2.0
 * widgets, templates, validators, design principles, and the authoring
 * methodology. Each entry cross-references real FlowOtter tools by name.
 *
 * Catalog data ships in `data.ts`; tests in `tests/unit/catalog/` check that
 * the data stays consistent with the rest of the code (e.g., every validator
 * file in src/toolkit/validate/rules/ has a catalog entry).
 */

import type { Capability } from '../../adapters/nodered/capabilities.js';

export type CatalogCategory =
  | 'node_red_concepts'
  | 'core_node_types'
  | 'dashboard_widgets'
  | 'templates'
  | 'validators'
  | 'design_principles'
  | 'layout_conventions'
  | 'methodology';

export type NodeTypeCategory =
  | 'input'
  | 'output'
  | 'function'
  | 'sequence'
  | 'parser'
  | 'storage'
  | 'network'
  | 'common';

export type WidgetStatus = 'supported' | 'missing' | 'partial';

export type DashboardWidgetCategory =
  | 'input'
  | 'display'
  | 'container'
  | 'interaction'
  | 'config'
  | 'chart'
  | 'table'
  | 'feedback';

export type ValidatorSeverity = 'error' | 'warning' | 'info';

export type ValidatorCategory =
  | 'structure'
  | 'dashboard'
  | 'function'
  | 'security'
  | 'style'
  | 'naming';

export type DesignPrincipleDomain = 'operator_dashboard' | 'general';

export type TemplateCategoryHint = 'generic' | 'dashboard' | 'operator' | 'pipeline';

/**
 * A Node-RED concept (tab, group, subflow, etc.) with usage guidance.
 * Concepts are abstract — they correspond to flows.json structural elements,
 * not specific node types.
 */
export interface ConceptEntry {
  readonly name: string;
  readonly purpose: string;
  readonly flow_otter_tools: readonly string[];
  readonly min_node_red_version?: string;
  readonly notes?: string;
}

/**
 * A core Node-RED node type from the default palette. Contrib types
 * (node-red-contrib-*) are not in this catalog; they're discovered via
 * `list_installed_node_types` at runtime.
 */
export interface NodeTypeEntry {
  readonly type: string;
  readonly category: NodeTypeCategory;
  readonly purpose: string;
  readonly min_node_red_version?: string;
  /**
   * Node-RED version-gated capabilities relevant to this node type. This is
   * plural because some node types, especially `function`, span multiple
   * independently-gated runtime/editor features.
   */
  readonly capabilities?: readonly Capability[];
  /** Tool name if a specialist exists (e.g., 'add_inject_node'). */
  readonly flow_otter_specialist?: string;
  /** Generic tool that always works (typically 'add_node'). */
  readonly generic_tool: 'add_node';
  readonly notes?: string;
}

/**
 * A Dashboard 2.0 widget. `flow_otter_status` records whether FlowOtter
 * currently exposes authoring support for the widget. Items 9-11 of the
 * v1.3.0 plan are addressing the `missing` entries.
 */
export interface DashboardWidgetEntry {
  readonly widget: string;
  readonly category: DashboardWidgetCategory;
  readonly purpose: string;
  readonly flow_otter_status: WidgetStatus;
  readonly required_parents: readonly string[];
  readonly notes?: string;
}

/**
 * A built-in template. Mirrors data in
 * `src/toolkit/templates/builtin.ts`; populated dynamically from
 * BUILTIN_TEMPLATES so the two stay in sync.
 */
export interface TemplateEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly description: string;
    readonly required?: boolean;
    readonly default?: string | number | boolean;
  }[];
  readonly category: TemplateCategoryHint;
}

/**
 * A validation rule shipped in `src/toolkit/validate/rules/`. The catalog
 * records the typical severity; some rules can emit at multiple severities
 * depending on the violation.
 */
export interface ValidatorEntry {
  readonly rule: string;
  readonly typical_severity: ValidatorSeverity;
  readonly category: ValidatorCategory;
  readonly checks: string;
}

/**
 * A design principle (e.g., ISA-101 operator-UI rules). These don't have a 1:1
 * mapping to validators today — Item 11 of v1.3.0 adds enforcement for
 * several principles flagged here.
 */
export interface DesignPrincipleEntry {
  readonly name: string;
  readonly domain: DesignPrincipleDomain;
  readonly rule: string;
  readonly rationale: string;
  readonly enforced_by?: readonly string[];
}

/**
 * One layout-readability criterion from the 2026-06-10 layout audit
 * (docs/audits/2026-06-10-layout-audit.md). Exactly EIGHT entries exist,
 * 1:1 with the audit criteria; together they teach the numeric layout
 * conventions (20px grid, 140-220px column pitch, 120px lane gap, ~1420px
 * visible viewport) in-band.
 *
 * `lint_rule` names the scored layout-lint rule that machine-checks the
 * criterion. The ids are FROZEN by the fix plan
 * (docs/plans/2026-06-10-fix-plan.md, items D-1/D-2) and register with the
 * v1.5.0 layout lint; until then `validate_flow` does not yet emit them.
 * tests/unit/catalog/layout-conventions.test.ts pins catalog ↔ rule-id
 * completeness in both directions once the rules exist.
 */
export interface LayoutConventionEntry {
  /** Stable snake_case id of the audit criterion. */
  readonly criterion: string;
  /** The convention statement, with its numbers. */
  readonly convention: string;
  /** Frozen scored layout-lint rule id (`layout-*` namespace). */
  readonly lint_rule: string;
  readonly notes?: string;
}

/**
 * The authoring methodology. One phase per object; the `tools` array
 * lists the FlowOtter tool calls associated with that phase.
 */
export interface MethodologyPhase {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
}

/**
 * The "organize" step's decision tree — when to use which structural
 * primitive. Each entry is a {trigger, action} pair.
 */
export interface OrganizeDecisionEntry {
  readonly trigger: string;
  readonly action: string;
}

export interface MethodologyEntry {
  readonly phases: readonly MethodologyPhase[];
  readonly organize_decision_tree: readonly OrganizeDecisionEntry[];
}

/**
 * The full capability catalog. Returned by `get_authoring_guide` either in
 * full or filtered by category.
 */
export interface CapabilityCatalog {
  readonly schema_version: '1';
  readonly flow_otter_version: string;
  readonly node_red_concepts: readonly ConceptEntry[];
  readonly core_node_types: readonly NodeTypeEntry[];
  readonly dashboard_widgets: readonly DashboardWidgetEntry[];
  readonly templates: readonly TemplateEntry[];
  readonly validators: readonly ValidatorEntry[];
  readonly design_principles: readonly DesignPrincipleEntry[];
  readonly layout_conventions: readonly LayoutConventionEntry[];
  readonly methodology: MethodologyEntry;
}
