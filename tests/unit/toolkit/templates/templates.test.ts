import { describe, expect, it } from 'vitest';

import { compile } from '../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../src/toolkit/authoring/types.js';
import {
  instantiateTemplate,
  listTemplates,
  TemplateNotFoundError,
} from '../../../../src/toolkit/templates/index.js';
import { runValidators } from '../../../../src/toolkit/validate/index.js';

const EMPTY_SPEC: AuthoringSpec = {
  tabs: [],
};

describe('built-in templates', () => {
  it('lists the template catalog', () => {
    const names = listTemplates().map((t) => t.name);
    expect(names).toEqual([
      'hello_world',
      'mqtt_to_debug',
      'inject_to_mqtt',
      'function_transform',
      'link_call_pair',
      'error_monitor',
      'status_monitor',
      'complete_monitor',
      'reusable_subflow',
      'dashboard_2_skeleton',
      'dashboard_2_status_panel',
      'dashboard_2_telemetry_chart',
      'dashboard_2_command_panel',
      'dashboard_2_form_input',
      'dashboard_2_gauge_grid',
      'dashboard_2_table_log',
      'dashboard_2_dual_theme',
      'dashboard_2_multi_page',
      'dashboard_2_template_widget',
      'dashboard_2_custom_css',
      'dashboard_2_alarm_panel',
      'dashboard_2_confirmed_button',
      'dashboard_2_mode_banner',
      'dashboard_2_live_value',
      'dashboard_2_audit_log_tail',
      'instrument_command_to_telemetry_pipeline',
      'parametrized_fleet_tab',
    ]);
  });

  it('instantiates hello_world deterministically', () => {
    const spec = instantiateTemplate(EMPTY_SPEC, 'hello_world', { tab_label: 'Hello Unit' });
    expect(spec.tabs).toHaveLength(1);
    expect(spec.tabs[0]?.label).toBe('Hello Unit');

    const first = compile(spec).flows;
    const second = compile(spec).flows;
    expect(second).toEqual(first);
  });

  it('instantiates dashboard_2_status_panel with a valid config-node hierarchy', () => {
    const spec = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_status_panel', { title: 'Ops' });
    const compiled = compile(spec);
    const report = runValidators(compiled.flows);
    expect(report.hasErrors).toBe(false);
    expect(compiled.flows.some((n) => n.type === 'ui-base')).toBe(true);
    expect(compiled.flows.some((n) => n.type === 'ui-page')).toBe(true);
    expect(compiled.flows.some((n) => n.type === 'ui-group')).toBe(true);
    expect(compiled.flows.some((n) => n.type === 'ui-text')).toBe(true);
  });

  it('throws a typed error for unknown templates', () => {
    expect(() => instantiateTemplate(EMPTY_SPEC, 'missing')).toThrow(TemplateNotFoundError);
  });
});

describe('Dashboard 2.0 templates', () => {
  const dashboard2Names = [
    'dashboard_2_skeleton',
    'dashboard_2_status_panel',
    'dashboard_2_telemetry_chart',
    'dashboard_2_command_panel',
    'dashboard_2_form_input',
    'dashboard_2_gauge_grid',
    'dashboard_2_table_log',
    'dashboard_2_dual_theme',
    'dashboard_2_multi_page',
    'dashboard_2_template_widget',
    'dashboard_2_custom_css',
  ] as const;

  for (const name of dashboard2Names) {
    it(`instantiates ${name} and passes all validators`, () => {
      const spec = instantiateTemplate(EMPTY_SPEC, name);
      const compiled = compile(spec);
      const report = runValidators(compiled.flows);
      expect(report.errors).toEqual([]);
      expect(report.hasErrors).toBe(false);
    });
  }

  it('dashboard_2_skeleton emits ui-base + ui-page + ui-theme + ui-group with no widgets', () => {
    const spec = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_skeleton', { title: 'Demo' });
    const compiled = compile(spec);
    const types = compiled.flows.map((n) => n.type);
    expect(types).toContain('ui-base');
    expect(types).toContain('ui-page');
    expect(types).toContain('ui-theme');
    expect(types).toContain('ui-group');
    expect(
      types.filter(
        (t) => t.startsWith('ui-') && !['ui-base', 'ui-page', 'ui-theme', 'ui-group'].includes(t),
      ),
    ).toEqual([]);
  });

  it('composes dashboard_2_skeleton + dashboard_2_telemetry_chart against a single skeleton', () => {
    const skel = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_skeleton');
    const composed = instantiateTemplate(skel, 'dashboard_2_telemetry_chart', {
      title: 'Voltage',
    });
    const compiled = compile(composed);
    const report = runValidators(compiled.flows);
    expect(report.errors).toEqual([]);

    // Exactly one ui-base / ui-page / ui-theme / ui-group survives — the chart
    // re-uses the skeleton's keys, it does not stamp duplicates.
    expect(compiled.flows.filter((n) => n.type === 'ui-base')).toHaveLength(1);
    expect(compiled.flows.filter((n) => n.type === 'ui-page')).toHaveLength(1);
    expect(compiled.flows.filter((n) => n.type === 'ui-theme')).toHaveLength(1);
    expect(compiled.flows.filter((n) => n.type === 'ui-group')).toHaveLength(1);
    expect(compiled.flows.filter((n) => n.type === 'ui-chart')).toHaveLength(1);

    const group = compiled.flows.find((n) => n.type === 'ui-group');
    const chart = compiled.flows.find((n) => n.type === 'ui-chart') as Record<string, unknown>;
    expect(chart['group']).toBe(group?.id);
  });

  it('composes dashboard_2_skeleton + dashboard_2_status_panel without duplicating structural nodes', () => {
    const skel = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_skeleton');
    const composed = instantiateTemplate(skel, 'dashboard_2_status_panel', { title: 'Health' });
    const compiled = compile(composed);
    const report = runValidators(compiled.flows);
    expect(report.errors).toEqual([]);
    expect(compiled.flows.filter((n) => n.type === 'ui-base')).toHaveLength(1);
    expect(compiled.flows.filter((n) => n.type === 'ui-page')).toHaveLength(1);
    expect(compiled.flows.filter((n) => n.type === 'ui-text')).toHaveLength(1);
  });

  it('dashboard_2_dual_theme emits two ui-theme nodes', () => {
    const spec = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_dual_theme');
    const compiled = compile(spec);
    expect(compiled.flows.filter((n) => n.type === 'ui-theme')).toHaveLength(2);
    expect(compiled.flows.some((n) => n.type === 'ui-button')).toBe(true);
    expect(compiled.flows.some((n) => n.type === 'ui-control')).toBe(true);
  });

  it('dashboard_2_multi_page emits one ui-base, three ui-pages, three ui-groups', () => {
    const spec = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_multi_page');
    const compiled = compile(spec);
    expect(compiled.flows.filter((n) => n.type === 'ui-base')).toHaveLength(1);
    expect(compiled.flows.filter((n) => n.type === 'ui-page')).toHaveLength(3);
    expect(compiled.flows.filter((n) => n.type === 'ui-group')).toHaveLength(3);
  });

  it('dashboard_2_template_widget emits a ui-template anchored to a ui-group', () => {
    const spec = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_template_widget', {
      title: 'My Widget',
    });
    const compiled = compile(spec);
    const tpl = compiled.flows.find((n) => n.type === 'ui-template') as Record<string, unknown>;
    expect(tpl['templateScope']).toBe('widget:group');
    expect(typeof tpl['group']).toBe('string');
    expect(tpl['format']).toContain('<template>');
  });

  it('dashboard_2_custom_css emits a site:style ui-template anchored to ui-base', () => {
    const spec = instantiateTemplate(EMPTY_SPEC, 'dashboard_2_custom_css');
    const compiled = compile(spec);
    const tpl = compiled.flows.find((n) => n.type === 'ui-template') as Record<string, unknown>;
    expect(tpl['templateScope']).toBe('site:style');
    expect(typeof tpl['ui']).toBe('string');
    expect(tpl['format']).toContain(':root');
  });

  it('every Dashboard 2.0 template compiles deterministically', () => {
    for (const name of dashboard2Names) {
      const spec = instantiateTemplate(EMPTY_SPEC, name);
      const a = compile(spec).flows;
      const b = compile(spec).flows;
      expect(b).toEqual(a);
    }
  });
});
