import { describe, expect, it } from 'vitest';

import { buildCatalog, selectCatalog } from '../../../src/toolkit/catalog/index.js';

const VERSION = '1.2.0-test';

describe('capability catalog', () => {
  it('builds a catalog with schema_version 1 and the supplied flow-otter version', () => {
    const cat = buildCatalog(VERSION);
    expect(cat.schema_version).toBe('1');
    expect(cat.flow_otter_version).toBe(VERSION);
  });

  it('has every top-level array populated', () => {
    const cat = buildCatalog(VERSION);
    expect(cat.node_red_concepts.length).toBeGreaterThan(5);
    expect(cat.core_node_types.length).toBeGreaterThan(20);
    expect(cat.dashboard_widgets.length).toBeGreaterThanOrEqual(24);
    expect(cat.templates.length).toBeGreaterThan(10);
    expect(cat.validators.length).toBeGreaterThanOrEqual(18);
    expect(cat.design_principles.length).toBeGreaterThan(3);
    expect(cat.methodology.phases.length).toBeGreaterThan(5);
    expect(cat.methodology.organize_decision_tree.length).toBeGreaterThan(3);
  });

  it('every dashboard widget has a status flag', () => {
    const cat = buildCatalog(VERSION);
    for (const w of cat.dashboard_widgets) {
      expect(['supported', 'missing', 'partial']).toContain(w.flow_otter_status);
    }
  });

  it('every core node type has a category and generic tool', () => {
    const cat = buildCatalog(VERSION);
    for (const n of cat.core_node_types) {
      expect(n.category).toBeDefined();
      expect(n.generic_tool).toBe('add_node');
    }
  });

  it('every validator entry has a severity and category', () => {
    const cat = buildCatalog(VERSION);
    for (const v of cat.validators) {
      expect(['error', 'warning', 'info']).toContain(v.typical_severity);
      expect(v.category).toBeDefined();
      expect(v.rule).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every methodology phase references at least zero tools (empty allowed for layout phase)', () => {
    const cat = buildCatalog(VERSION);
    for (const p of cat.methodology.phases) {
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(Array.isArray(p.tools)).toBe(true);
    }
  });

  it('every design principle has a domain and rationale', () => {
    const cat = buildCatalog(VERSION);
    for (const dp of cat.design_principles) {
      expect(['operator_dashboard', 'general']).toContain(dp.domain);
      expect(dp.rule.length).toBeGreaterThan(0);
      expect(dp.rationale.length).toBeGreaterThan(0);
    }
  });

  it('cross-references real FlowOtter tool names in concepts', () => {
    const cat = buildCatalog(VERSION);
    const knownTools = new Set([
      'list_flows',
      'get_flow',
      'create_flow',
      'add_node',
      'get_node',
      'update_node',
      'remove_node',
      'move_node',
      'wire_nodes',
      'set_wires',
      'add_group',
      'create_subflow_definition',
      'add_subflow_instance',
      'get_subflow',
      'add_link_in_node',
      'add_link_out_node',
      'add_link_call_node',
      'set_links',
      'add_comment',
    ]);
    for (const concept of cat.node_red_concepts) {
      for (const tool of concept.flow_otter_tools) {
        expect(knownTools, `concept '${concept.name}' references unknown tool '${tool}'`).toContain(
          tool,
        );
      }
    }
  });
});

describe('selectCatalog', () => {
  it('returns the full catalog when categories is undefined', () => {
    const cat = selectCatalog(VERSION, undefined);
    expect((cat as { node_red_concepts?: readonly unknown[] }).node_red_concepts).toBeDefined();
    expect((cat as { templates?: readonly unknown[] }).templates).toBeDefined();
  });

  it('returns the full catalog when categories is empty', () => {
    const cat = selectCatalog(VERSION, []);
    expect((cat as { node_red_concepts?: readonly unknown[] }).node_red_concepts).toBeDefined();
  });

  it('returns only the requested categories', () => {
    const cat = selectCatalog(VERSION, ['core_node_types']);
    expect((cat as { core_node_types?: readonly unknown[] }).core_node_types).toBeDefined();
    expect((cat as { templates?: readonly unknown[] }).templates).toBeUndefined();
    expect((cat as { dashboard_widgets?: readonly unknown[] }).dashboard_widgets).toBeUndefined();
  });

  it('returns multiple requested categories', () => {
    const cat = selectCatalog(VERSION, ['methodology', 'design_principles']);
    expect((cat as { methodology?: unknown }).methodology).toBeDefined();
    expect((cat as { design_principles?: readonly unknown[] }).design_principles).toBeDefined();
    expect((cat as { templates?: readonly unknown[] }).templates).toBeUndefined();
  });
});
