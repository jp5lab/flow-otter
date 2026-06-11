import { describe, expect, it } from 'vitest';

import { findPrompt, PROMPTS } from '../../../../src/server/prompts/registry.js';

describe('FlowOtter prompts registry', () => {
  it('exposes the canonical 5 slash-command prompts', () => {
    const names = PROMPTS.map((p) => p.name);
    expect(names).toEqual([
      'new_flow',
      'build_operator_dashboard',
      'refactor_to_subflow',
      'explain_my_flow',
      'review_my_flow',
    ]);
  });

  it('every prompt has a description and at least zero typed arguments', () => {
    for (const p of PROMPTS) {
      expect(p.description.length).toBeGreaterThan(0);
      expect(Array.isArray(p.arguments)).toBe(true);
    }
  });

  it.each(['new_flow', 'build_operator_dashboard', 'refactor_to_subflow'])(
    '%s declares all its arguments as required where the workflow needs them',
    (name) => {
      const p = findPrompt(name)!;
      expect(p.arguments.some((a) => a.required === true)).toBe(true);
    },
  );

  it('findPrompt returns undefined for unknown names', () => {
    expect(findPrompt('not-a-prompt')).toBeUndefined();
  });

  it('new_flow builds a body referencing plan_flow + the methodology phases', () => {
    const body = findPrompt('new_flow')!.build({ goal: 'pipe MQTT to debug' });
    expect(body).toContain('plan_flow');
    expect(body).toContain('add_node');
    expect(body).toContain('wire_nodes');
    expect(body).toContain('render_flow_svg');
    expect(body).toContain('preview_flow_diff');
    expect(body).toContain('deploy_staged_change');
    expect(body).toContain('pipe MQTT to debug');
  });

  // D-5: the layout step teaches the numeric conventions (same pinned token
  // set as SERVER_INSTRUCTIONS — fix-plan F4 regression anchors).
  it.each(['20px', '140-220', 'BELOW', 'port 0', '1420', '120'])(
    'new_flow layout step teaches convention token %s',
    (token) => {
      const body = findPrompt('new_flow')!.build({ goal: 'x' });
      expect(body).toContain(token);
    },
  );

  it('new_flow with template arg references instantiate_template', () => {
    const body = findPrompt('new_flow')!.build({ goal: 'x', template: 'mqtt_to_debug' });
    expect(body).toContain("instantiate_template('mqtt_to_debug')");
  });

  it('build_operator_dashboard maps known dashboard types to existing templates', () => {
    const body = findPrompt('build_operator_dashboard')!.build({
      dashboard_type: 'alarms',
      title: 'Tank A Alarms',
    });
    expect(body).toContain('dashboard_2_alarm_panel');
    expect(body).toContain('Tank A Alarms');
  });

  it('build_operator_dashboard mentions ISA-101 and the related validators', () => {
    const body = findPrompt('build_operator_dashboard')!.build({
      dashboard_type: 'trend',
      title: 'Pressure',
    });
    expect(body).toContain('ISA-101');
    expect(body).toContain('validate_flow');
  });

  it('refactor_to_subflow walks through create_subflow_definition + add_subflow_instance', () => {
    const body = findPrompt('refactor_to_subflow')!.build({
      tab_id: 'tab1',
      node_ids: 'n1,n2,n3',
      subflow_name: 'NormalizeMessage',
    });
    expect(body).toContain('create_subflow_definition');
    expect(body).toContain('add_subflow_instance');
    expect(body).toContain('NormalizeMessage');
    expect(body).toContain('tab1');
  });

  it('explain_my_flow uses explain_flow + render_flow_svg', () => {
    const body = findPrompt('explain_my_flow')!.build({ tab_id: 'tab1' });
    expect(body).toContain("explain_flow('tab1')");
    expect(body).toContain('render_flow_svg');
  });

  it('review_my_flow uses analyze + validate + render', () => {
    const body = findPrompt('review_my_flow')!.build({});
    expect(body).toContain('analyze_all_flows');
    expect(body).toContain('validate_all_flows');
  });

  // D-5: review_my_flow gained a layout-scores step pointing at the
  // layout_conventions catalog category and validate_flow's layout scores.
  it('review_my_flow includes the layout-scores review step', () => {
    const body = findPrompt('review_my_flow')!.build({});
    expect(body).toContain("get_authoring_guide(['layout_conventions'])");
    expect(body).toContain('layout scores');
  });
});
