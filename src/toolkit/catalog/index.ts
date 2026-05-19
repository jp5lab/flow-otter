import {
  CORE_NODE_TYPES,
  DASHBOARD_2_WIDGETS,
  DESIGN_PRINCIPLES,
  METHODOLOGY,
  NODE_RED_CONCEPTS,
  TEMPLATES,
  VALIDATORS,
} from './data.js';
import type {
  CapabilityCatalog,
  CatalogCategory,
  ConceptEntry,
  DashboardWidgetEntry,
  DesignPrincipleEntry,
  MethodologyEntry,
  NodeTypeEntry,
  TemplateEntry,
  ValidatorEntry,
} from './types.js';

export type {
  CapabilityCatalog,
  CatalogCategory,
  ConceptEntry,
  DashboardWidgetEntry,
  DesignPrincipleEntry,
  MethodologyEntry,
  NodeTypeEntry,
  TemplateEntry,
  ValidatorEntry,
} from './types.js';

export function buildCatalog(flowOtterVersion: string): CapabilityCatalog {
  return {
    schema_version: '1',
    flow_otter_version: flowOtterVersion,
    node_red_concepts: NODE_RED_CONCEPTS,
    core_node_types: CORE_NODE_TYPES,
    dashboard_widgets: DASHBOARD_2_WIDGETS,
    templates: TEMPLATES,
    validators: VALIDATORS,
    design_principles: DESIGN_PRINCIPLES,
    methodology: METHODOLOGY,
  };
}

/**
 * Subset of the catalog. `categories: ['all']` (or omitted) returns the
 * full catalog. Otherwise returns just the requested top-level keys.
 */
export interface CatalogSubset {
  readonly schema_version: '1';
  readonly flow_otter_version: string;
  readonly node_red_concepts?: readonly ConceptEntry[];
  readonly core_node_types?: readonly NodeTypeEntry[];
  readonly dashboard_widgets?: readonly DashboardWidgetEntry[];
  readonly templates?: readonly TemplateEntry[];
  readonly validators?: readonly ValidatorEntry[];
  readonly design_principles?: readonly DesignPrincipleEntry[];
  readonly methodology?: MethodologyEntry;
}

export function selectCatalog(
  flowOtterVersion: string,
  categories: readonly CatalogCategory[] | undefined,
): CatalogSubset {
  const full = buildCatalog(flowOtterVersion);
  if (categories === undefined || categories.length === 0) return full;
  const subset: CatalogSubset = {
    schema_version: '1',
    flow_otter_version: flowOtterVersion,
  };
  for (const c of categories) {
    switch (c) {
      case 'node_red_concepts':
        (subset as { node_red_concepts: readonly ConceptEntry[] }).node_red_concepts =
          full.node_red_concepts;
        break;
      case 'core_node_types':
        (subset as { core_node_types: readonly NodeTypeEntry[] }).core_node_types =
          full.core_node_types;
        break;
      case 'dashboard_widgets':
        (subset as { dashboard_widgets: readonly DashboardWidgetEntry[] }).dashboard_widgets =
          full.dashboard_widgets;
        break;
      case 'templates':
        (subset as { templates: readonly TemplateEntry[] }).templates = full.templates;
        break;
      case 'validators':
        (subset as { validators: readonly ValidatorEntry[] }).validators = full.validators;
        break;
      case 'design_principles':
        (subset as { design_principles: readonly DesignPrincipleEntry[] }).design_principles =
          full.design_principles;
        break;
      case 'methodology':
        (subset as { methodology: MethodologyEntry }).methodology = full.methodology;
        break;
    }
  }
  return subset;
}
