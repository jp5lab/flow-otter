/**
 * Integration tests for the v0.6.0 deploy-recovery and staging-guard fixes.
 *
 * Covers:
 * - Per-session staging guard: deploy refuses when staged.agent_id !=
 *   ctx.agentId without force_takeover.
 * - force_takeover succeeds and reports takeover=true.
 * - Happy-path deploy reports recovered_from_partial=false +
 *   retried_on_rev_mismatch=false.
 *
 * The partial-deploy verify-by-hash and rev-mismatch retry paths require
 * a custom fetchImpl that simulates mid-flight failures; covered at the
 * unit-test level via mocked fetches in `tests/unit/server/tools/deploy/`.
 * Here we exercise the surface against a real Node-RED.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  deployed_hash: string;
  forced: boolean;
  takeover: boolean;
  recovered_from_partial: boolean;
  retried_on_rev_mismatch: boolean;
}

describe('v0.6.0 deploy: staging guard + recovery output fields', () => {
  it('happy-path deploy reports takeover=false + no recovery flags', async () => {
    const stage = (await callTool(rig.registry, rig.container, 'add_debug_node', {
      tab_id: '1111111111111111',
      source_node_id: '2222222222222222',
    })) as AddDebugResult;
    expect(stage.staged_hash).toBeTruthy();

    const deploy = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: stage.staged_hash,
      deploy_mode: 'nodes',
    })) as DeployResult;
    expect(deploy.ok).toBe(true);
    expect(deploy.forced).toBe(false);
    expect(deploy.takeover).toBe(false);
    expect(deploy.recovered_from_partial).toBe(false);
    expect(deploy.retried_on_rev_mismatch).toBe(false);
  });

  it('refuses deploy when staged.agent_id mismatches without force_takeover', async () => {
    // Stage with agent_id A
    await callTool(rig.registry, rig.container, 'add_debug_node', {
      tab_id: '1111111111111111',
      source_node_id: '2222222222222222',
    });
    const stagedFromA = await rig.container.staging.read();
    expect(stagedFromA?.agent_id).toBe(rig.container.agentId);

    // Simulate a different session: directly tamper with staged.agent_id on
    // disk so it doesn't match the live container's agentId.
    if (stagedFromA) {
      await rig.container.staging.write({
        ...stagedFromA,
        agent_id: 'pid-99999999',
      });
    }

    // The same container now sees a stage authored by a different process.
    const staged = await rig.container.staging.read();
    await expect(
      callTool(rig.registry, rig.container, 'deploy_staged_change', {
        staged_hash: staged!.stagedHash,
        deploy_mode: 'nodes',
      }),
    ).rejects.toThrow(/different agent process/);
  });

  it('force_takeover:true succeeds and reports takeover=true', async () => {
    await callTool(rig.registry, rig.container, 'add_debug_node', {
      tab_id: '1111111111111111',
      source_node_id: '2222222222222222',
    });
    const staged = await rig.container.staging.read();
    if (staged) {
      await rig.container.staging.write({
        ...staged,
        agent_id: 'pid-99999999',
      });
    }
    const stagedNow = await rig.container.staging.read();

    const deploy = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: stagedNow!.stagedHash,
      deploy_mode: 'nodes',
      force_takeover: true,
    })) as DeployResult;
    expect(deploy.ok).toBe(true);
    expect(deploy.takeover).toBe(true);
  });
});
