import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../src/shared/flows-json.js';
import { canonicalHash } from '../../src/shared/hash.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = path.resolve(HERE, '../fixtures/inject-to-debug.flows.json');

const TAB_A = 'aaaaaaaaaaaaaaaa';
const TAB_B = 'bbbbbbbbbbbbbbbb';

const TWO_TAB_FIXTURE: FlowsJson = [
  { id: TAB_A, type: 'tab', label: 'Tab A', _authoringKey: TAB_A },
  { id: TAB_B, type: 'tab', label: 'Tab B', _authoringKey: TAB_B },
  {
    id: 'a000000000000001',
    type: 'inject',
    z: TAB_A,
    x: 100,
    y: 100,
    wires: [['a000000000000002']],
    name: 'A Inject',
    _authoringKey: 'a-inject',
  },
  {
    id: 'a000000000000002',
    type: 'function',
    z: TAB_A,
    x: 300,
    y: 100,
    wires: [['a000000000000003']],
    name: 'A Function',
    func: 'return msg;',
    outputs: 1,
    _authoringKey: 'a-function',
  },
  {
    id: 'a000000000000003',
    type: 'debug',
    z: TAB_A,
    x: 500,
    y: 100,
    wires: [],
    name: 'A Debug',
    _authoringKey: 'a-debug',
  },
  {
    id: 'a000000000000004',
    type: 'status',
    z: TAB_A,
    x: 100,
    y: 240,
    wires: [[]],
    name: 'A Status',
    _authoringKey: 'a-status',
  },
  {
    id: 'b000000000000001',
    type: 'inject',
    z: TAB_B,
    x: 100,
    y: 100,
    wires: [['b000000000000002']],
    name: 'B Inject',
    _authoringKey: 'b-inject',
  },
  {
    id: 'b000000000000002',
    type: 'function',
    z: TAB_B,
    x: 300,
    y: 100,
    wires: [['b000000000000003']],
    name: 'B Function',
    func: 'return msg;',
    outputs: 1,
    _authoringKey: 'b-function',
  },
  {
    id: 'b000000000000003',
    type: 'debug',
    z: TAB_B,
    x: 500,
    y: 100,
    wires: [],
    name: 'B Debug',
    _authoringKey: 'b-debug',
  },
  {
    id: 'b000000000000004',
    type: 'catch',
    z: TAB_B,
    x: 100,
    y: 240,
    wires: [[]],
    name: 'B Catch',
    _authoringKey: 'b-catch',
  },
];

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

afterAll(async () => {
  await seedDefaultFixture();
  await rig.cleanup();
});

interface StageResult {
  ok: boolean;
  staged_hash: string;
}

interface DeployResult {
  ok: boolean;
  deployed_hash: string;
  snapshot_before: string;
}

interface RollbackResult {
  ok: boolean;
  restored_hash: string;
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

async function seedDefaultFixture(): Promise<void> {
  if (rig === undefined) return;
  const raw = await readFile(DEFAULT_FIXTURE_PATH, 'utf8');
  const flows = JSON.parse(raw) as FlowsJson;
  await postFlows(flows);
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

function originalNodeIds(): Map<string, string> {
  const ids = new Map<string, string>();
  for (const node of TWO_TAB_FIXTURE) {
    if (node.type === 'tab') continue;
    const key = (node as Record<string, unknown>)['_authoringKey'];
    if (typeof key === 'string') ids.set(key, node.id);
  }
  return ids;
}

function currentNodeIds(flows: FlowsJson): Map<string, string> {
  const ids = new Map<string, string>();
  for (const node of flows) {
    if (node.type === 'tab') continue;
    const key = (node as Record<string, unknown>)['_authoringKey'];
    if (typeof key === 'string') ids.set(key, node.id);
  }
  return ids;
}

async function stageAndDeploy(tool: string, input: unknown): Promise<DeployResult> {
  const staged = (await callTool(rig.registry, rig.container, tool, input)) as StageResult;
  expect(staged.ok).toBe(true);

  const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
    staged_hash: staged.staged_hash,
  })) as DeployResult;
  expect(deployed.ok).toBe(true);
  expect(deployed.deployed_hash).toBe(staged.staged_hash);
  return deployed;
}

describe('multi-edit ID preservation', () => {
  it('preserves original IDs across staged multi-tab edits and rollback', async () => {
    await postFlows(TWO_TAB_FIXTURE);

    const initialFlows = await fetchRuntimeFlows();
    const initialHash = canonicalHash(initialFlows);
    const expectedIds = originalNodeIds();

    const firstDeploy = await stageAndDeploy('add_inject_node', {
      tab_id: TAB_A,
      opts: { label: 'Added Inject' },
    });
    await stageAndDeploy('add_mqtt_in_node', {
      tab_id: TAB_B,
      opts: { label: 'MQTT In' },
    });
    await stageAndDeploy('add_function_node', {
      tab_id: TAB_A,
      opts: { label: 'Added Function' },
    });
    await stageAndDeploy('move_node', {
      source_tab_id: TAB_A,
      node_key: 'a-status',
      dest_tab_id: TAB_B,
      position: { x: 700, y: 240 },
    });

    const afterEdits = await fetchRuntimeFlows();
    const afterIds = currentNodeIds(afterEdits);
    for (const [key, id] of expectedIds) {
      expect(afterIds.get(key)).toBe(id);
    }

    const rolledBack = (await callTool(rig.registry, rig.container, 'rollback_last_change', {
      snapshot_id: firstDeploy.snapshot_before,
    })) as RollbackResult;
    expect(rolledBack.ok).toBe(true);
    expect(rolledBack.restored_hash).toBe(initialHash);

    const afterRollback = await fetchRuntimeFlows();
    expect(canonicalHash(afterRollback)).toBe(initialHash);
  });
});
