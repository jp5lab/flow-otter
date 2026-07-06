import { readFile } from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FlowsJson } from '../../src/shared/flows-json.js';
import { canonicalHash } from '../../src/shared/hash.js';

import { FIXTURE_INJECT_ID, FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;

beforeAll(async () => {
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const raw = await readFile(
    new URL('../fixtures/inject-to-debug.flows.json', import.meta.url),
    'utf8',
  );
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: raw,
  });
  if (!res.ok) throw new Error(`reseed failed: ${res.status}`);
  await rig.container.staging.clear();
});

afterAll(async () => {
  await rig.cleanup();
});

interface StageChangesResult {
  ok: boolean;
  staged_hash: string;
  based_on_snapshot_hash: string;
  op_results: unknown[];
  amended: boolean;
}

async function fetchRuntimeFlows(): Promise<FlowsJson> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`runtime fetch failed: ${res.status}`);
  const parsed = await res.json();
  return Array.isArray(parsed) ? (parsed as FlowsJson) : (parsed as { flows: FlowsJson }).flows;
}

describe('stage_changes against live runtime', () => {
  it('stages an atomic add+wire batch, deploys it, and rolls it back', async () => {
    const initialHash = canonicalHash(await fetchRuntimeFlows());
    const staged = (await callTool(rig.registry, rig.container, 'stage_changes', {
      ops: [
        {
          op: 'add_node',
          tab_id: FIXTURE_TAB_ID,
          type: 'debug',
          opts: { key: 'batch-debug', position: { x: 300, y: 100 } },
        },
        {
          op: 'wire_nodes',
          tab_id: FIXTURE_TAB_ID,
          from_key: FIXTURE_INJECT_ID,
          to_key: 'batch-debug',
        },
      ],
    })) as StageChangesResult;

    expect(staged.ok).toBe(true);
    expect(staged.based_on_snapshot_hash).toBe(initialHash);
    expect(staged.op_results).toHaveLength(2);

    const pending = await rig.container.staging.read();
    expect(pending?.stagedHash).toBe(staged.staged_hash);

    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      confirm: true,
      staged_hash: staged.staged_hash,
    })) as { ok: boolean; deployed_hash: string };
    expect(deployed.ok).toBe(true);
    expect(deployed.deployed_hash).toBe(staged.staged_hash);

    const flows = await fetchRuntimeFlows();
    const debug = flows.find(
      (n) => (n as Record<string, unknown>)['_authoringKey'] === 'batch-debug',
    );
    const inject = flows.find((n) => n.id === FIXTURE_INJECT_ID) as { wires?: string[][] };
    expect(debug).toBeDefined();
    expect(inject.wires?.[0]).toContain(debug!.id);

    await callTool(rig.registry, rig.container, 'rollback_last_change', {});
    expect(canonicalHash(await fetchRuntimeFlows())).toBe(initialHash);
  });

  it('amends an existing pending batch only when amend_of matches', async () => {
    const first = (await callTool(rig.registry, rig.container, 'stage_changes', {
      ops: [{ op: 'add_comment', tab_id: FIXTURE_TAB_ID, key: 'first', text: 'first' }],
    })) as StageChangesResult;

    await expect(
      callTool(rig.registry, rig.container, 'stage_changes', {
        amend_of: 'wrong-hash',
        ops: [{ op: 'add_comment', tab_id: FIXTURE_TAB_ID, key: 'wrong', text: 'wrong' }],
      }),
    ).rejects.toThrow(/pending deploy.*discard_staged_change/s);
    expect((await rig.container.staging.read())?.stagedHash).toBe(first.staged_hash);

    const amended = (await callTool(rig.registry, rig.container, 'stage_changes', {
      amend_of: first.staged_hash,
      ops: [{ op: 'add_comment', tab_id: FIXTURE_TAB_ID, key: 'amended', text: 'amended' }],
    })) as StageChangesResult;

    expect(amended.ok).toBe(true);
    expect(amended.amended).toBe(true);
    expect(amended.staged_hash).not.toBe(first.staged_hash);
    expect((await rig.container.staging.read())?.stagedHash).toBe(amended.staged_hash);
  });
});
