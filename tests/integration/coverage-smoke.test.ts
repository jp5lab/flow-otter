/**
 * Smoke-coverage tests for tools that lacked integration coverage:
 *  - add_node (generic node-add)
 *  - add_dashboard_widget
 *  - set_flows_state (requires runtimeState.enabled in settings.js)
 *
 * Each test stages + deploys (where applicable) against the Docker stack.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

interface StageResult {
  ok: boolean;
  staged_hash: string;
}

interface FlowsStateResult {
  ok: boolean;
  state: string;
  prior_state: string;
}

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const fixturePath = new URL('../fixtures/inject-to-debug.flows.json', import.meta.url);
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(fixturePath, 'utf8');
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: raw,
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
  await rig.container.staging.clear();
});

afterAll(async () => {
  await rig.cleanup();
});

describe('coverage smoke', () => {
  it('add_node stages a generic change node', async () => {
    const out = (await callTool(rig.registry, rig.container, 'add_node', {
      tab_id: FIXTURE_TAB_ID,
      type: 'change',
      opts: { label: 'Change' },
    })) as StageResult;
    expect(out.ok).toBe(true);
    expect(out.staged_hash).toBeTruthy();
  });

  it('add_dashboard_widget stages a ui-text widget with full Dashboard 2.0 scaffold', async () => {
    // Use the dashboard_2_skeleton template to ensure ui-base/page/group exist.
    await callTool(rig.registry, rig.container, 'instantiate_template', {
      template_name: 'dashboard_2_skeleton',
      params: { tab_id: FIXTURE_TAB_ID },
    });
    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: (await rig.container.staging.read())?.stagedHash,
    })) as { ok: boolean };
    expect(deployed.ok).toBe(true);

    const out = (await callTool(rig.registry, rig.container, 'add_dashboard_widget', {
      tab_id: FIXTURE_TAB_ID,
      widget_type: 'ui-markdown',
      opts: { group_key: 'ui-group', label: 'Hello' },
    })) as StageResult;
    expect(out.ok).toBe(true);
  });

  it('set_flows_state can stop and start the runtime (requires runtimeState.enabled)', async () => {
    const stopped = (await callTool(rig.registry, rig.container, 'set_flows_state', {
      state: 'stop',
    })) as FlowsStateResult;
    expect(stopped.ok).toBe(true);
    expect(stopped.state).toBe('stop');

    const started = (await callTool(rig.registry, rig.container, 'set_flows_state', {
      state: 'start',
    })) as FlowsStateResult;
    expect(started.ok).toBe(true);
    expect(started.state).toBe('start');
  });
});
