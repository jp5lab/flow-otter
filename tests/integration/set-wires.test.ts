import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const TAB_ID = '4444444444444444';
const INJ_ID = '5555000000000001';
const D1_ID = '6666000000000001';
const D2_ID = '6666000000000002';
const D3_ID = '6666000000000003';

const FLOWS = [
  { id: TAB_ID, type: 'tab', label: 'W', disabled: false, info: '' },
  {
    id: INJ_ID,
    type: 'inject',
    z: TAB_ID,
    x: 100,
    y: 100,
    wires: [[D1_ID, D2_ID]],
    name: 'Inj',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: 'x',
    payloadType: 'str',
  },
  { id: D1_ID, type: 'debug', z: TAB_ID, x: 300, y: 100, wires: [], name: 'D1' },
  { id: D2_ID, type: 'debug', z: TAB_ID, x: 300, y: 200, wires: [], name: 'D2' },
  { id: D3_ID, type: 'debug', z: TAB_ID, x: 300, y: 300, wires: [], name: 'D3' },
];

interface StageResult {
  ok: boolean;
  wires_removed_count: number;
  wires_added_count: number;
  staged_hash: string;
}

let rig: TestRig;

async function postFlows(): Promise<void> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: JSON.stringify(FLOWS),
  });
  if (!res.ok) throw new Error(`POST /flows: ${res.status} ${await res.text()}`);
}

async function fetchInjectWires(): Promise<readonly string[][]> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2' },
  });
  const json = (await res.json()) as { flows: readonly { id: string; wires?: string[][] }[] };
  const inj = json.flows.find((n) => n.id === INJ_ID);
  return inj?.wires ?? [];
}

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  await postFlows();
  await rig.container.staging.clear();
});

afterAll(async () => {
  await rig.cleanup();
});

describe('set_wires integration', () => {
  it('replaces inject port-0 wires from [D1, D2] to [D3]', async () => {
    const staged = (await callTool(rig.registry, rig.container, 'set_wires', {
      tab_id: TAB_ID,
      source_node_id: INJ_ID,
      target_node_ids: [D3_ID],
    })) as StageResult;
    expect(staged.ok).toBe(true);
    expect(staged.wires_removed_count).toBe(2);
    expect(staged.wires_added_count).toBe(1);

    await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      confirm: true,
      staged_hash: staged.staged_hash,
    });

    const wires = await fetchInjectWires();
    expect(wires).toEqual([[D3_ID]]);
  });

  it('clears wires with empty target list', async () => {
    const staged = (await callTool(rig.registry, rig.container, 'set_wires', {
      tab_id: TAB_ID,
      source_node_id: INJ_ID,
      target_node_ids: [],
    })) as StageResult;
    expect(staged.wires_removed_count).toBe(2);
    expect(staged.wires_added_count).toBe(0);

    await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      confirm: true,
      staged_hash: staged.staged_hash,
    });

    const wires = await fetchInjectWires();
    expect(wires).toEqual([[]]);
  });
});
