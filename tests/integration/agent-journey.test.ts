/**
 * Agent-journey end-to-end test — the v1 thesis test.
 *
 * Walks a complete agent loop against a real Node-RED runtime:
 *   set_target → stage author op → deploy → observe debug via /comms →
 *   rollback → clear_target.
 *
 * When this test is green, the FlowOtter toolkit can drive a Node-RED instance
 * from clean → modified → observed → restored entirely in-toolkit, without
 * any out-of-band intervention. This is the central claim of v1.0.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { canonicalHash } from '../../src/shared/hash.js';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;
let tmpRoot: string;

const TAB_ID = '7777777777777777';
const INJECT_ID = '8888888888888888';
const SEED_FLOWS = [
  { id: TAB_ID, type: 'tab', label: 'Agent-Journey', disabled: false, info: '' },
  {
    id: INJECT_ID,
    type: 'inject',
    z: TAB_ID,
    x: 100,
    y: 100,
    wires: [[]],
    name: 'AJ-Inject',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: 'aj/tick',
    payload: 'AGENT_JOURNEY_PAYLOAD',
    payloadType: 'str',
  },
];

interface SetTargetResult {
  ok: boolean;
  reachable: boolean;
}
interface AddDebugResult {
  ok: boolean;
  staged_hash: string;
  added_node_id?: string;
}
interface DeployResult {
  ok: boolean;
  deployed_hash: string;
}
interface DebugMsg {
  id?: string;
  z?: string;
  msg: string;
}
interface DebugResult {
  ok: boolean;
  connected: boolean;
  messages: DebugMsg[];
}
interface RollbackResult {
  ok: boolean;
  restored_hash: string;
}
interface ClearTargetResult {
  ok: boolean;
}

async function seedFlows(): Promise<{ rev: string | null; hash: string }> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
    body: JSON.stringify(SEED_FLOWS),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  // Read back hash for assertion.
  const fr = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2' },
  });
  const { flows, rev } = (await fr.json()) as { flows: unknown; rev?: string };
  return { rev: rev ?? null, hash: canonicalHash(flows) };
}

async function fireInject(): Promise<void> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/inject/${INJECT_ID}`, { method: 'POST' });
  if (!res.ok) throw new Error(`fire inject: ${res.status}`);
}

async function fetchRuntimeHash(): Promise<string> {
  const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
  const res = await fetch(`${baseUrl}/flows`, {
    headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2' },
  });
  const { flows } = (await res.json()) as { flows: unknown };
  return canonicalHash(flows);
}

async function pollFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`pollFor: predicate never resolved within ${timeoutMs}ms`);
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'aj-'));
  rig = await buildIntegrationRig();
});

beforeEach(async () => {
  await seedFlows();
  await rig.container.staging.clear();
});

afterAll(async () => {
  rig.container.comms?.dispose();
  await rig.cleanup();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('v1 agent-journey: set_target → stage → deploy → observe → rollback → clear_target', () => {
  it('closes the full author/observe/rollback loop without out-of-band intervention', async () => {
    // 0. Capture pristine runtime hash for the post-rollback assertion.
    const pristineHash = await fetchRuntimeHash();

    // 1. set_target (admin-api)
    const target = (await callTool(rig.registry, rig.container, 'set_target', {
      flow_source: 'admin-api',
      base_url: rig.container.config.NODE_RED_BASE_URL!,
      env_name: 'aj-target',
      snapshot_dir: path.join(tmpRoot, 'snapshots'),
      staging_dir: path.join(tmpRoot, 'staging'),
      audit_log_path: path.join(tmpRoot, 'audit.jsonl'),
      persist: false,
    })) as SetTargetResult;
    expect(target.ok).toBe(true);
    expect(target.reachable).toBe(true);

    // 2. stage a new debug node connected to the inject
    const staged = (await callTool(rig.registry, rig.container, 'add_debug_node', {
      tab_id: TAB_ID,
      source_node_id: INJECT_ID,
      opts: { label: 'AJ-Out' },
    })) as AddDebugResult;
    expect(staged.ok).toBe(true);
    expect(staged.added_node_id).toBeTruthy();

    // 3. deploy
    const deployed = (await callTool(rig.registry, rig.container, 'deploy_staged_change', {
      staged_hash: staged.staged_hash,
    })) as DeployResult;
    expect(deployed.ok).toBe(true);
    expect(deployed.deployed_hash).toBe(staged.staged_hash);

    // 4. fire the inject so the debug node emits a frame
    //    First, prime the comms client + verify it lands.
    await callTool(rig.registry, rig.container, 'get_recent_debug_messages', {});
    await fireInject();

    // 5. observe the debug message via get_recent_debug_messages
    await pollFor(async () => {
      const out = (await callTool(rig.registry, rig.container, 'get_recent_debug_messages', {
        node_id: staged.added_node_id,
      })) as DebugResult;
      return out.messages.some((m) => m.msg.includes('AGENT_JOURNEY_PAYLOAD'));
    });

    // 6. rollback
    const rolledBack = (await callTool(
      rig.registry,
      rig.container,
      'rollback_last_change',
      {},
    )) as RollbackResult;
    expect(rolledBack.ok).toBe(true);

    // 7. runtime hash now matches pristine
    const restoredHash = await fetchRuntimeHash();
    expect(restoredHash).toBe(pristineHash);

    // 8. clear_target
    const cleared = (await callTool(rig.registry, rig.container, 'clear_target', {
      env_name: 'aj-target',
    })) as ClearTargetResult;
    expect(cleared.ok).toBe(true);
  });
});
