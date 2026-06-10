import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { canonicalHash } from '../../src/shared/hash.js';

import { FIXTURE_INJECT_ID, FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  await reseedFixture();
  await rig.container.staging.clear();
});

afterAll(async () => {
  await rig.cleanup();
});

interface AddDebugResult {
  ok: boolean;
  staged_hash: string;
  based_on_snapshot_hash: string;
  diff_summary: {
    nodes_added: number;
    nodes_removed: number;
    wires_added: number;
    wires_removed: number;
  };
  added_node_id?: string;
}

interface DeployResult {
  ok: boolean;
  deployed_hash: string;
  rev_after: string | null;
  snapshot_before: string;
}

interface RollbackResult {
  ok: boolean;
  restored_snapshot_id: string;
  restored_hash: string;
}

async function fetchRuntimeFlows(): Promise<{ flows: unknown; rev: string | null }> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2' },
  });
  if (!res.ok) throw new Error(`runtime fetch failed: ${res.status}`);
  const text = await res.text();
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return { flows: parsed, rev: null };
  const obj = parsed as { flows: unknown; rev?: string };
  return { flows: obj.flows, rev: typeof obj.rev === 'string' ? obj.rev : null };
}

async function reseedFixture(): Promise<void> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const fixturePath = new URL('../fixtures/inject-to-debug.flows.json', import.meta.url);
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(fixturePath, 'utf8');
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Node-RED-Deployment-Type': 'full',
    },
    body: raw,
  });
  if (!res.ok) throw new Error(`reseed failed: ${res.status} ${await res.text()}`);
}

describe('add_debug_node end-to-end', () => {
  it('stages → deploys → rolls back, leaving runtime in original state', async () => {
    // Capture initial state
    const initial = await fetchRuntimeFlows();
    const initialHash = canonicalHash(initial.flows);

    // 1. Stage
    const staged = (await callTool(rig.registry, rig.container, 'add_debug_node', {
      tab_id: FIXTURE_TAB_ID,
      source_node_id: FIXTURE_INJECT_ID,
      opts: { label: 'Tick Out' },
    })) as AddDebugResult;

    expect(staged.ok).toBe(true);
    expect(staged.diff_summary.nodes_added).toBe(1);
    expect(staged.diff_summary.wires_added).toBe(1);
    expect(staged.diff_summary.nodes_removed).toBe(0);
    expect(staged.diff_summary.wires_removed).toBe(0);
    expect(staged.based_on_snapshot_hash).toBe(initialHash);

    // 2. Deploy
    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      confirm: true,
      staged_hash: staged.staged_hash,
    })) as DeployResult;

    expect(deployed.ok).toBe(true);
    expect(deployed.deployed_hash).toBe(staged.staged_hash);

    // Confirm runtime received the staged content
    const afterDeploy = await fetchRuntimeFlows();
    const afterDeployHash = canonicalHash(afterDeploy.flows);
    expect(afterDeployHash).toBe(staged.staged_hash);

    // 3. Rollback
    const rolledBack = (await callTool(
      rig.registry,
      rig.container,
      'rollback_last_change',
      {},
    )) as RollbackResult;

    expect(rolledBack.ok).toBe(true);

    const afterRollback = await fetchRuntimeFlows();
    const afterRollbackHash = canonicalHash(afterRollback.flows);
    expect(afterRollbackHash).toBe(initialHash);
  });

  it('health_check reports the configured Node-RED instance is reachable', async () => {
    const result = (await callTool(rig.registry, rig.container, 'health_check', {})) as {
      ok: boolean;
      flow_source: { kind: string; target: string };
      flow_source_reachable: boolean;
    };
    expect(result.flow_source.kind).toBe('adminapi');
    expect(result.flow_source_reachable).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('get_server_config_summary redacts secrets', async () => {
    const result = (await callTool(
      rig.registry,
      rig.container,
      'get_server_config_summary',
      {},
    )) as { config: Record<string, unknown> };
    // Whether or not a token was set, the value must be ***SET*** or ***UNSET***.
    const tokenField = String(result.config['NODE_RED_AUTH_TOKEN']);
    expect(['***SET***', '***UNSET***']).toContain(tokenField);
    expect(JSON.stringify(result)).not.toMatch(/Bearer\s+\S+/);
  });
});
