import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const TAB_1 = 'aaaaaaaaaaaaaaaa';
const TAB_2 = 'bbbbbbbbbbbbbbbb';
const LOUT_ID = '1111000000000001';
const LIN_ID = '2222000000000002';
const LCALL_ID = '3333000000000003';

const FLOWS = [
  { id: TAB_1, type: 'tab', label: 'A', disabled: false, info: '' },
  { id: TAB_2, type: 'tab', label: 'B', disabled: false, info: '' },
  {
    id: LOUT_ID,
    type: 'link out',
    z: TAB_1,
    x: 100,
    y: 100,
    wires: [],
    name: 'Source Out',
    links: [],
  },
  {
    id: LCALL_ID,
    type: 'link call',
    z: TAB_1,
    x: 200,
    y: 100,
    wires: [[]],
    name: 'Source Call',
    links: [LIN_ID],
  },
  {
    id: LIN_ID,
    type: 'link in',
    z: TAB_2,
    x: 100,
    y: 100,
    wires: [[]],
    name: 'Target In',
    links: [],
  },
];

interface StageResult {
  ok: boolean;
  paired_count: number;
  staged_hash: string;
}

interface DeployResult {
  ok: boolean;
  deployed_hash: string;
}

let rig: TestRig;

async function postFlows(flows: unknown): Promise<void> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: JSON.stringify(flows),
  });
  if (!res.ok) throw new Error(`POST /flows: ${res.status} ${await res.text()}`);
}

async function fetchFlows(): Promise<readonly { id: string; links?: string[] }[]> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2' },
  });
  const json = (await res.json()) as { flows: readonly { id: string; links?: string[] }[] };
  return json.flows;
}

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  await postFlows(FLOWS);
  await rig.container.staging.clear();
});

afterAll(async () => {
  await rig.cleanup();
});

describe('set_links integration', () => {
  it('pairs link out → link in across tabs; deploy makes runtime see the links', async () => {
    const staged = (await callTool(rig.registry, rig.container, 'set_links', {
      source_node_id: LOUT_ID,
      target_node_ids: [LIN_ID],
    })) as StageResult;
    expect(staged.ok).toBe(true);
    expect(staged.paired_count).toBe(1);

    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: staged.staged_hash,
    })) as DeployResult;
    expect(deployed.ok).toBe(true);

    const flows = await fetchFlows();
    const linkOut = flows.find((n) => n.id === LOUT_ID);
    expect(linkOut?.links).toEqual([LIN_ID]);
  });

  it('clearing targets sets links to empty array', async () => {
    // First, pair them.
    const paired = (await callTool(rig.registry, rig.container, 'set_links', {
      source_node_id: LOUT_ID,
      target_node_ids: [LIN_ID],
    })) as StageResult;
    await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: paired.staged_hash,
    });
    // Now clear.
    const cleared = (await callTool(rig.registry, rig.container, 'set_links', {
      source_node_id: LOUT_ID,
      target_node_ids: [],
    })) as StageResult;
    expect(cleared.paired_count).toBe(0);
    await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: cleared.staged_hash,
    });

    const flows = await fetchFlows();
    const linkOut = flows.find((n) => n.id === LOUT_ID);
    expect(linkOut?.links).toEqual([]);
  });
});
