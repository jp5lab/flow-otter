import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../src/shared/flows-json.js';
import { canonicalHash } from '../../src/shared/hash.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const TAB_1 = '1111111111111111';
const TAB_2 = '2222222222222222';
const SOURCE_ID = '3333333333333333';
const TARGET_ID = '4444444444444444';
const LINK_IN_ID = '5555555555555555';
const SUBFLOW_ID = '6666666666666666';

const BASE_FLOWS: FlowsJson = [
  { id: TAB_1, type: 'tab', label: 'Main', _authoringKey: TAB_1 },
  { id: TAB_2, type: 'tab', label: 'Aux', _authoringKey: TAB_2 },
  {
    id: SUBFLOW_ID,
    type: 'subflow',
    name: 'Reusable',
    in: [],
    out: [{ x: 60, y: 80, wires: [] }],
    _authoringKey: SUBFLOW_ID,
  },
  {
    id: SOURCE_ID,
    type: 'inject',
    z: TAB_1,
    x: 100,
    y: 100,
    wires: [[]],
    name: 'Source',
    _authoringKey: 'source',
  },
  {
    id: TARGET_ID,
    type: 'debug',
    z: TAB_1,
    x: 300,
    y: 100,
    wires: [],
    name: 'Target',
    _authoringKey: 'target',
  },
  {
    id: LINK_IN_ID,
    type: 'link in',
    z: TAB_1,
    x: 100,
    y: 260,
    wires: [[]],
    name: 'Link In',
    links: [],
    _authoringKey: 'link-in-target',
  },
];

const AUTHOR_TOOL_CASES: readonly {
  name: string;
  input: unknown;
}[] = [
  { name: 'add_inject_node', input: { tab_id: TAB_1, opts: { label: 'Inject' } } },
  { name: 'add_function_node', input: { tab_id: TAB_1, opts: { label: 'Function' } } },
  { name: 'add_catch_node', input: { tab_id: TAB_1, opts: { label: 'Catch' } } },
  { name: 'add_status_node', input: { tab_id: TAB_1, opts: { label: 'Status' } } },
  { name: 'add_complete_node', input: { tab_id: TAB_1, opts: { label: 'Complete' } } },
  { name: 'add_mqtt_in_node', input: { tab_id: TAB_1, opts: { label: 'MQTT In' } } },
  { name: 'add_mqtt_out_node', input: { tab_id: TAB_1, opts: { label: 'MQTT Out' } } },
  { name: 'add_link_in_node', input: { tab_id: TAB_1, opts: { label: 'Link In 2' } } },
  { name: 'add_link_out_node', input: { tab_id: TAB_1, opts: { label: 'Link Out' } } },
  {
    name: 'add_link_call_node',
    input: { tab_id: TAB_1, opts: { label: 'Link Call', passthrough: { links: [LINK_IN_ID] } } },
  },
  { name: 'add_subflow_instance', input: { tab_id: TAB_1, defId: SUBFLOW_ID } },
  { name: 'add_group', input: { tab_id: TAB_1, name: 'Group' } },
  { name: 'add_comment', input: { tab_id: TAB_1, text: 'Comment', position: { x: 100, y: 420 } } },
  { name: 'wire_nodes', input: { tab_id: TAB_1, from_key: 'source', to_key: 'target' } },
  { name: 'remove_node', input: { tab_id: TAB_1, node_key: 'target' } },
  {
    name: 'update_node',
    input: { tab_id: TAB_1, node_key: 'source', label: 'Source Updated' },
  },
  {
    name: 'move_node',
    input: {
      source_tab_id: TAB_1,
      node_key: 'source',
      dest_tab_id: TAB_2,
      position: { x: 120, y: 120 },
    },
  },
  { name: 'create_subflow_definition', input: { name: 'Created Subflow' } },
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

interface StageResult {
  ok: boolean;
  staged_hash: string;
}

interface AddGroupStageResult extends StageResult {
  added_group_id?: string;
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

describe('author tools end-to-end', () => {
  for (const c of AUTHOR_TOOL_CASES) {
    it(`${c.name} stages, deploys, and rolls back`, async () => {
      const initialHash = canonicalHash(await fetchRuntimeFlows());
      const staged = (await callTool(rig.registry, rig.container, c.name, c.input)) as StageResult;
      expect(staged.ok).toBe(true);
      expect(staged.staged_hash).not.toBe(initialHash);

      const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
        confirm: true,
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
  }

  it('all D author tools are registered and listable', () => {
    const names = rig.registry.listTools().map((t) => t.name);
    for (const c of AUTHOR_TOOL_CASES) {
      expect(names, `tool ${c.name} should be registered`).toContain(c.name);
    }
  });

  it('adds same-key groups on two tabs without cross-tab id theft', async () => {
    const first = (await callTool(rig.registry, rig.container, 'add_group', {
      tab_id: TAB_2,
      key: 'shared-group',
      name: 'Shared',
    })) as AddGroupStageResult;
    expect(first.ok).toBe(true);
    expect(first.added_group_id).toBeDefined();

    await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      confirm: true,
      staged_hash: first.staged_hash,
    });

    const second = (await callTool(rig.registry, rig.container, 'add_group', {
      tab_id: TAB_1,
      key: 'shared-group',
      name: 'Shared',
    })) as AddGroupStageResult;
    expect(second.ok).toBe(true);
    expect(second.added_group_id).toBeDefined();
    expect(second.added_group_id).not.toBe(first.added_group_id);

    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      confirm: true,
      staged_hash: second.staged_hash,
    })) as DeployResult;
    expect(deployed.ok).toBe(true);

    const groups = (await fetchRuntimeFlows()).filter(
      (n) =>
        n.type === 'group' && (n as Record<string, unknown>)['_authoringKey'] === 'shared-group',
    );
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.id)).size).toBe(2);
  });
});
