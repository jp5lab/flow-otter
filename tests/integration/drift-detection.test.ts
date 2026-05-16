import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_INJECT_ID, FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

afterAll(async () => {
  await rig.cleanup();
});

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

beforeEach(async () => {
  await reseedFixture();
  await rig.container.staging.clear();
});

interface AddDebugResult {
  staged_hash: string;
}
interface DeployResult {
  ok: boolean;
  forced: boolean;
}

async function postOutOfBandEdit(): Promise<void> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  // Use v1 (array) form for the out-of-band edit so we don't need to thread rev.
  const flowsRes = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json' },
  });
  const parsed = (await flowsRes.json()) as unknown[];
  const mutated = [
    ...(parsed as Record<string, unknown>[]),
    {
      id: 'aaaaaaaaaaaaaaaa',
      type: 'comment',
      z: FIXTURE_TAB_ID,
      x: 50,
      y: 50,
      name: 'out-of-band',
    },
  ];
  const post = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Node-RED-Deployment-Type': 'full',
    },
    body: JSON.stringify(mutated),
  });
  if (!post.ok) {
    const body = await post.text();
    throw new Error(`out-of-band edit failed: ${post.status} ${body}`);
  }
}

describe('drift detection', () => {
  it('refuses deploy when runtime has drifted; force=true overrides', async () => {
    const staged = (await callTool(rig.registry, rig.container, 'add_debug_node', {
      tab_id: FIXTURE_TAB_ID,
      source_node_id: FIXTURE_INJECT_ID,
    })) as AddDebugResult;

    // Mutate the runtime out-of-band so the staged.basedOnSnapshotHash no longer matches.
    await postOutOfBandEdit();

    await expect(
      callTool(rig.registry, rig.container, 'deploy_staged_change', {
        staged_hash: staged.staged_hash,
      }),
    ).rejects.toMatchObject({ name: 'DriftError' });

    // With force=true, deploy succeeds.
    const forced = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: staged.staged_hash,
      force: true,
    })) as DeployResult;
    expect(forced.ok).toBe(true);
    expect(forced.forced).toBe(true);
  });
});
