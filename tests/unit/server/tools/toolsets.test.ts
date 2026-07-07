import { describe, expect, it } from 'vitest';

import { buildContainer } from '../../../../src/server/container.js';
import { ALL_TOOLS } from '../../../../src/server/index.js';
import { makeInvokable } from '../../../../src/server/tools/_tool.js';
import { buildRegistry } from '../../../../src/server/tools/register.js';
import {
  DEFAULT_TOOLSETS,
  TOOLSETS,
  listedToolNames,
  toolsetOf,
  type ToolsetName,
} from '../../../../src/server/tools/toolsets.js';

const DEFAULT_VISIBLE_TOOLS = [
  'clear_target',
  'deploy_staged_change',
  'discard_staged_change',
  'enable_toolset',
  'get_authoring_guide',
  'get_flow',
  'get_staged_change',
  'health_check',
  'layout_flow',
  'list_available_toolsets',
  'list_flows',
  'plan_flow',
  'preview_flow_diff',
  'render_flow_png',
  'rollback_last_change',
  'set_flows_state',
  'set_target',
  'stage_changes',
  'stage_spec',
  'validate_flow',
  'validate_spec',
] as const;

function buildFullRegistry() {
  const container = buildContainer({
    serverVersion: '0.1.0-test',
    env: {
      FLOW_SOURCE: 'file',
      FLOW_FILE_PATH: './flows.json',
      ENABLE_WRITE_TOOLS: 'true',
      ENABLE_DEPLOY_TOOLS: 'true',
      READ_ONLY_MODE: 'false',
      LOG_LEVEL: 'silent',
    },
  });
  const registry = buildRegistry(container, ALL_TOOLS);
  container.toolRegistry = registry;
  return registry;
}

function hasAdditionalPropertiesFalse(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some((v) => hasAdditionalPropertiesFalse(v));
  if (typeof schema !== 'object' || schema === null) return false;
  const record = schema as Record<string, unknown>;
  if (record['additionalProperties'] === false) return true;
  return Object.values(record).some((v) => hasAdditionalPropertiesFalse(v));
}

describe('toolsets', () => {
  it('includes the canonical set of toolset names', () => {
    const names = new Set(Object.keys(TOOLSETS));
    expect(names).toEqual(
      new Set<ToolsetName>([
        'core',
        'essentials',
        'discovery',
        'analyze',
        'snapshots',
        'audit',
        'author',
        'author_specialists',
        'layout',
        'spec_authoring',
        'deploy',
        'dangerous',
      ]),
    );
  });

  it('default toolsets expose the D7 intent-shaped surface only', () => {
    expect(DEFAULT_TOOLSETS).toEqual(['core', 'essentials', 'layout', 'spec_authoring', 'deploy']);
    expect(
      buildFullRegistry()
        .listTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual([...DEFAULT_VISIBLE_TOOLS]);
  });

  it('default toolsets exclude demoted, author_specialists, and dangerous toolsets', () => {
    expect(DEFAULT_TOOLSETS).not.toContain('discovery');
    expect(DEFAULT_TOOLSETS).not.toContain('analyze');
    expect(DEFAULT_TOOLSETS).not.toContain('snapshots');
    expect(DEFAULT_TOOLSETS).not.toContain('audit');
    expect(DEFAULT_TOOLSETS).not.toContain('author');
    expect(DEFAULT_TOOLSETS).not.toContain('author_specialists');
    expect(DEFAULT_TOOLSETS).not.toContain('dangerous');
    expect(DEFAULT_TOOLSETS).toContain('core');
    expect(DEFAULT_TOOLSETS).toContain('essentials');
    expect(DEFAULT_TOOLSETS).toContain('layout');
    expect(DEFAULT_TOOLSETS).toContain('spec_authoring');
    expect(DEFAULT_TOOLSETS).toContain('deploy');
  });

  it('every tool listed in any toolset is a real tool in ALL_TOOLS', () => {
    const toolsetTools = listedToolNames();
    const actualTools = new Set(ALL_TOOLS.map((t) => t.name));
    const orphans = [...toolsetTools].filter((n) => !actualTools.has(n));
    expect(orphans, `Toolsets reference unknown tools: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every tool in ALL_TOOLS belongs to exactly one toolset (or falls to core)', () => {
    for (const tool of ALL_TOOLS) {
      const owner = toolsetOf(tool.name);
      expect(owner, `toolsetOf(${tool.name}) should resolve`).toBeDefined();
    }
  });

  it('list_available_toolsets and enable_toolset are in core', () => {
    expect(toolsetOf('list_available_toolsets')).toBe('core');
    expect(toolsetOf('enable_toolset')).toBe('core');
  });

  it('essentials owns the default read and review tools', () => {
    expect(toolsetOf('get_authoring_guide')).toBe('essentials');
    expect(toolsetOf('list_flows')).toBe('essentials');
    expect(toolsetOf('get_flow')).toBe('essentials');
    expect(toolsetOf('validate_flow')).toBe('essentials');
    expect(toolsetOf('render_flow_png')).toBe('essentials');
    expect(toolsetOf('preview_flow_diff')).toBe('essentials');
    expect(toolsetOf('get_staged_change')).toBe('essentials');
  });

  it('add_node is in author, not author_specialists', () => {
    expect(toolsetOf('add_node')).toBe('author');
  });

  it('specialist tools are in author_specialists, not author', () => {
    expect(toolsetOf('add_inject_node')).toBe('author_specialists');
    expect(toolsetOf('add_function_node')).toBe('author_specialists');
    expect(toolsetOf('add_link_call_node')).toBe('author_specialists');
  });

  it('dangerous tools are in the dangerous toolset', () => {
    expect(toolsetOf('replace_flows')).toBe('dangerous');
    expect(toolsetOf('reset_runtime')).toBe('dangerous');
    expect(toolsetOf('delete_tab')).toBe('dangerous');
  });

  it('layout_flow is in the default-on layout toolset', () => {
    expect(toolsetOf('layout_flow')).toBe('layout');
    expect(TOOLSETS.layout.default_enabled).toBe(true);
    expect(TOOLSETS.layout.description).toContain('S6 evaluation gate passed');
  });

  it('spec authoring tools are in the default-on spec_authoring toolset', () => {
    expect(toolsetOf('stage_spec')).toBe('spec_authoring');
    expect(toolsetOf('validate_spec')).toBe('spec_authoring');
    expect(toolsetOf('plan_flow')).toBe('spec_authoring');
    expect(toolsetOf('stage_changes')).toBe('spec_authoring');
    expect(toolsetOf('discard_staged_change')).toBe('spec_authoring');
    expect(TOOLSETS.spec_authoring.default_enabled).toBe(true);
    expect(TOOLSETS.spec_authoring.description).toContain('S6 evaluation gate passed');
  });

  it('demoted toolsets are hidden by default but callable during the deprecation window', () => {
    const registry = buildFullRegistry();
    const visible = registry.listTools().map((t) => t.name);
    expect(visible).not.toContain('add_node');
    expect(visible).not.toContain('analyze_flow');
    expect(visible).not.toContain('get_server_config_summary');
    expect(visible).not.toContain('get_snapshot');
    expect(visible).not.toContain('get_audit_log_recent');

    expect(registry.find('add_node')?.name).toBe('add_node');
    expect(registry.find('analyze_flow')?.name).toBe('analyze_flow');
    expect(registry.find('get_server_config_summary')?.name).toBe('get_server_config_summary');
    expect(registry.find('get_snapshot')?.name).toBe('get_snapshot');
    expect(registry.find('get_audit_log_recent')?.name).toBe('get_audit_log_recent');

    expect(registry.find('add_inject_node')).toBeUndefined();
    expect(registry.find('delete_flow')).toBeUndefined();
  });

  it('demoted toolsets carry explicit supersession records', () => {
    for (const name of ['discovery', 'analyze', 'snapshots', 'audit', 'author'] as const) {
      expect(TOOLSETS[name].default_enabled).toBe(false);
      expect(TOOLSETS[name].callable_when_disabled).toBe(true);
      expect(TOOLSETS[name].demotion).toMatchObject({
        since: '2.0.0',
        removal: 'no earlier than 2.2.0',
      });
    }
    expect(TOOLSETS.author.demotion?.superseded_by).toContain('stage_spec / stage_changes');
    expect(TOOLSETS.author_specialists.callable_when_disabled).toBe(false);
    expect(TOOLSETS.dangerous.callable_when_disabled).toBe(false);
  });

  it('every registered tool advertises a relaxed object output schema', () => {
    for (const tool of ALL_TOOLS) {
      const invokable = makeInvokable(tool);
      expect(invokable.outputJsonSchema, tool.name).toBeDefined();
      expect(invokable.outputJsonSchema?.['type'], tool.name).toBe('object');
      expect(invokable.outputJsonSchema?.['additionalProperties'], tool.name).not.toBe(false);
      expect(hasAdditionalPropertiesFalse(invokable.outputJsonSchema), tool.name).toBe(false);
    }
  });

  it('no tool appears in more than one toolset', () => {
    const seen = new Map<string, ToolsetName>();
    for (const [name, t] of Object.entries(TOOLSETS) as [
      ToolsetName,
      (typeof TOOLSETS)[ToolsetName],
    ][]) {
      for (const tn of t.tool_names) {
        const prior = seen.get(tn);
        if (prior !== undefined) {
          throw new Error(`Tool '${tn}' appears in both ${prior} and ${name}`);
        }
        seen.set(tn, name);
      }
    }
  });
});
