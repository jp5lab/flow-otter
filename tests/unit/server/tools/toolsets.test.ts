import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../../../../src/server/index.js';
import {
  DEFAULT_TOOLSETS,
  TOOLSETS,
  listedToolNames,
  toolsetOf,
  type ToolsetName,
} from '../../../../src/server/tools/toolsets.js';

describe('toolsets', () => {
  it('includes the canonical set of toolset names', () => {
    const names = new Set(Object.keys(TOOLSETS));
    expect(names).toEqual(
      new Set<ToolsetName>([
        'core',
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

  it('default toolsets exclude author_specialists, layout, spec_authoring, and dangerous', () => {
    expect(DEFAULT_TOOLSETS).not.toContain('author_specialists');
    expect(DEFAULT_TOOLSETS).not.toContain('layout');
    expect(DEFAULT_TOOLSETS).not.toContain('spec_authoring');
    expect(DEFAULT_TOOLSETS).not.toContain('dangerous');
    expect(DEFAULT_TOOLSETS).toContain('core');
    expect(DEFAULT_TOOLSETS).toContain('author');
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

  it('layout_flow is in the default-off layout toolset', () => {
    expect(toolsetOf('layout_flow')).toBe('layout');
    expect(TOOLSETS.layout.default_enabled).toBe(false);
    expect(TOOLSETS.layout.description).toContain('S6 evaluation gate');
  });

  it('spec authoring tools are in the default-off spec_authoring toolset', () => {
    expect(toolsetOf('stage_spec')).toBe('spec_authoring');
    expect(toolsetOf('validate_spec')).toBe('spec_authoring');
    expect(TOOLSETS.spec_authoring.default_enabled).toBe(false);
    expect(TOOLSETS.spec_authoring.description).toContain('S6 evaluation gate');
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
