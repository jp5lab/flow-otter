import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../src/shared/flows-json.js';
import { canonicalHash } from '../../src/shared/hash.js';
import { DANGEROUS_CONFIRMATION_TEXT } from '../../src/server/tools/dangerous/_confirmation.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const TAB_1 = '1111111111111111';
const TAB_2 = '2222222222222222';

const BASE_FLOWS: FlowsJson = [
  { id: TAB_1, type: 'tab', label: 'Main', _authoringKey: 'main' },
  { id: TAB_2, type: 'tab', label: 'Aux', _authoringKey: 'aux' },
  {
    id: '3333333333333333',
    type: 'inject',
    z: TAB_1,
    x: 100,
    y: 100,
    wires: [],
    name: 'Seed Main',
    _authoringKey: 'main-seed',
  },
  {
    id: '4444444444444444',
    type: 'debug',
    z: TAB_2,
    x: 300,
    y: 100,
    wires: [],
    name: 'Seed Aux',
    _authoringKey: 'aux-seed',
  },
];

let defaultRig: TestRig;
let dangerousRig: TestRig;

beforeAll(async () => {
  defaultRig = await buildIntegrationRig();
  dangerousRig = await buildIntegrationRig({ ENABLE_DANGEROUS_TOOLS: 'true' });
});

beforeEach(async () => {
  await postFlows(BASE_FLOWS);
  await dangerousRig.container.staging.clear();
});

afterAll(async () => {
  await defaultRig.cleanup();
  await dangerousRig.cleanup();
});

interface PreparedDangerousOperation {
  confirmation_token: string;
}

interface DeleteTabResult {
  ok: boolean;
  deleted_tab_id: string;
  new_hash: string;
}

interface DeployResult {
  ok: boolean;
  deployed_hash: string;
}

interface RollbackResult {
  ok: boolean;
}

async function postFlows(flows: FlowsJson): Promise<void> {
  const baseUrl = dangerousRig.container.config.NODE_RED_BASE_URL!;
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
  const baseUrl = dangerousRig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2' },
  });
  if (!res.ok) throw new Error(`runtime fetch failed: ${res.status}`);
  const parsed = await res.json();
  if (Array.isArray(parsed)) return parsed as FlowsJson;
  return (parsed as { flows: FlowsJson }).flows;
}

async function prepareDeleteTab(tabId: string): Promise<string> {
  const prepared = (await callTool(
    dangerousRig.registry,
    dangerousRig.container,
    'prepare_dangerous_operation',
    {
      operation: 'delete_tab',
      target: tabId,
      confirmation_text: DANGEROUS_CONFIRMATION_TEXT,
    },
  )) as PreparedDangerousOperation;
  return prepared.confirmation_token;
}

describe('dangerous tools end-to-end', () => {
  it('dangerous tools are absent without ENABLE_DANGEROUS_TOOLS=true', () => {
    const defaultNames = defaultRig.registry.listTools().map((t) => t.name);
    expect(defaultNames).not.toContain('prepare_dangerous_operation');
    expect(defaultNames).not.toContain('replace_flows');
    expect(defaultNames).not.toContain('delete_tab');
    expect(defaultNames).not.toContain('reset_runtime');

    const dangerousNames = dangerousRig.registry.listTools().map((t) => t.name);
    expect(dangerousNames).toContain('prepare_dangerous_operation');
    expect(dangerousNames).toContain('replace_flows');
    expect(dangerousNames).toContain('delete_tab');
    expect(dangerousNames).toContain('reset_runtime');
  });

  it('delete_tab deploys and rollback_last_change restores the runtime', async () => {
    const initialHash = canonicalHash(await fetchRuntimeFlows());
    const confirmation = await prepareDeleteTab(TAB_1);

    const deleted = (await callTool(dangerousRig.registry, dangerousRig.container, 'delete_tab', {
      tab_id: TAB_1,
      confirmation_token: confirmation,
    })) as DeleteTabResult;
    expect(deleted.ok).toBe(true);
    expect(deleted.deleted_tab_id).toBe(TAB_1);
    expect(canonicalHash(await fetchRuntimeFlows())).toBe(deleted.new_hash);

    const rolledBack = (await callTool(
      dangerousRig.registry,
      dangerousRig.container,
      'rollback_last_change',
      {},
    )) as RollbackResult;
    expect(rolledBack.ok).toBe(true);
    expect(canonicalHash(await fetchRuntimeFlows())).toBe(initialHash);
  });

  it('deploy_staged_change uses the current runtime rev when the hash still matches', async () => {
    const { flows, rev } = await dangerousRig.container.flowSource.load();
    const stagedFlows: FlowsJson = [
      ...flows,
      {
        id: 'aaaaaaaaaaaaaaaa',
        type: 'comment',
        z: TAB_1,
        x: 60,
        y: 60,
        name: 'rev-safe',
      },
    ];
    const stagedHash = canonicalHash(stagedFlows);
    await dangerousRig.container.staging.write({
      flows: stagedFlows,
      basedOnSnapshotHash: canonicalHash(flows),
      basedOnRev: rev === null ? 'stale-rev' : `${rev}-stale`,
      stagedHash,
      stagedAt: dangerousRig.container.clock().toISOString(),
      actor: dangerousRig.container.config.ACTOR_NAME,
      reason: 'rev-refresh-test',
    });

    const deployed = (await callTool(
      dangerousRig.registry,
      dangerousRig.container,
      'deploy_staged_change',
      { staged_hash: stagedHash, confirm: true },
    )) as DeployResult;
    expect(deployed.ok).toBe(true);
    expect(deployed.deployed_hash).toBe(stagedHash);
    expect(canonicalHash(await fetchRuntimeFlows())).toBe(stagedHash);
  });
});
