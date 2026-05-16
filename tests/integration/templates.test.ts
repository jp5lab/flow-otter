import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../src/shared/flows-json.js';
import { canonicalHash } from '../../src/shared/hash.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const BASE_FLOWS: FlowsJson = [
  { id: '1111111111111111', type: 'tab', label: 'Main', _authoringKey: 'main' },
  {
    id: '2222222222222222',
    type: 'inject',
    z: '1111111111111111',
    x: 100,
    y: 100,
    wires: [],
    name: 'Seed',
    _authoringKey: 'seed',
  },
];

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  await postFlows(BASE_FLOWS);
});

afterAll(async () => {
  await rig.cleanup();
});

interface ListTemplatesResult {
  templates: Array<{ name: string }>;
}

interface StageTemplateResult {
  ok: boolean;
  staged_hash: string;
  template_name: string;
}

interface DeployResult {
  ok: boolean;
  deployed_hash: string;
}

interface RollbackResult {
  ok: boolean;
}

async function postFlows(flows: FlowsJson): Promise<void> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Node-RED-Deployment-Type': 'full',
    },
    body: JSON.stringify(flows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to seed flows: HTTP ${res.status} ${body}`);
  }
}

async function fetchRuntimeFlows(): Promise<FlowsJson> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2' },
  });
  if (!res.ok) throw new Error(`runtime fetch failed: ${res.status}`);
  const parsed = await res.json();
  if (Array.isArray(parsed)) return parsed as FlowsJson;
  return (parsed as { flows: FlowsJson }).flows;
}

describe('template tools end-to-end', () => {
  it('lists templates and deploys a staged template with rollback', async () => {
    const listed = (await callTool(
      rig.registry,
      rig.container,
      'list_templates',
      {},
    )) as ListTemplatesResult;
    expect(listed.templates.map((t) => t.name)).toContain('hello_world');

    const initialHash = canonicalHash(await fetchRuntimeFlows());
    const staged = (await callTool(rig.registry, rig.container, 'instantiate_template', {
      template_name: 'hello_world',
      params: { tab_label: 'Hello Integration' },
    })) as StageTemplateResult;
    expect(staged.ok).toBe(true);
    expect(staged.template_name).toBe('hello_world');
    expect(staged.staged_hash).not.toBe(initialHash);

    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: staged.staged_hash,
    })) as DeployResult;
    expect(deployed.ok).toBe(true);
    expect(deployed.deployed_hash).toBe(staged.staged_hash);
    expect(canonicalHash(await fetchRuntimeFlows())).toBe(staged.staged_hash);

    const rolledBack = (await callTool(
      rig.registry,
      rig.container,
      'rollback_last_change',
      {},
    )) as RollbackResult;
    expect(rolledBack.ok).toBe(true);
    expect(canonicalHash(await fetchRuntimeFlows())).toBe(initialHash);
  });
});
