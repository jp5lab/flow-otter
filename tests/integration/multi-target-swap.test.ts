/**
 * Multi-target swap test. Verifies that `set_target` → work → `clear_target`
 * → `set_target` (different env_name) → work preserves per-target state
 * isolation: snapshot / staging / audit each live under `~/.flow-otter/<env>/`
 * and never cross-contaminate.
 *
 * Uses two ephemeral *file-source* targets so this test doesn't require a
 * second Node-RED runtime.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

let rig: TestRig;
let envARoot: string;
let envBRoot: string;
let flowsAPath: string;
let flowsBPath: string;
let cleanupRoots: Array<() => Promise<void>> = [];

interface SetTargetResult {
  ok: boolean;
  flow_source: string;
  env_name: string;
  snapshot_dir: string;
  staging_dir: string;
  audit_log_path: string;
}

interface StageResult {
  ok: boolean;
  staged_hash: string;
}

const TAB_ID = 'tab-mts';
const INJECT_ID = 'inj-mts';
const FIXTURE = [
  { id: TAB_ID, type: 'tab', label: 'Multi-Target', disabled: false, info: '' },
  {
    id: INJECT_ID,
    type: 'inject',
    z: TAB_ID,
    x: 100,
    y: 100,
    wires: [[]],
    name: 'Inj',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '',
    payloadType: 'date',
  },
];

beforeAll(async () => {
  // Use a rig that starts on file-source so we can swap targets without
  // hitting Docker for this test.
  envARoot = await mkdtemp(path.join(tmpdir(), 'mts-envA-'));
  envBRoot = await mkdtemp(path.join(tmpdir(), 'mts-envB-'));
  flowsAPath = path.join(envARoot, 'flows.json');
  flowsBPath = path.join(envBRoot, 'flows.json');
  await writeFile(flowsAPath, JSON.stringify(FIXTURE), 'utf8');
  await writeFile(flowsBPath, JSON.stringify(FIXTURE), 'utf8');
  cleanupRoots.push(async () => rm(envARoot, { recursive: true, force: true }));
  cleanupRoots.push(async () => rm(envBRoot, { recursive: true, force: true }));

  rig = await buildIntegrationRig({
    // Boot in file mode so set_target swaps don't depend on Docker.
    // (NODE_RED_BASE_URL is set by the helper but unused once FLOW_SOURCE=file.)
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsAPath,
  });
});

afterAll(async () => {
  await rig.cleanup();
  for (const c of cleanupRoots) await c();
  cleanupRoots = [];
});

describe('multi-target swap isolation', () => {
  it('staging under env A then swapping to env B leaves env A staging untouched', async () => {
    // 1. set_target(env A)
    const targetA = (await callTool(rig.registry, rig.container, 'set_target', {
      flow_source: 'file',
      file_path: flowsAPath,
      env_name: 'mts-envA',
      snapshot_dir: path.join(envARoot, 'snapshots'),
      staging_dir: path.join(envARoot, 'staging'),
      audit_log_path: path.join(envARoot, 'audit.jsonl'),
      persist: false,
    })) as SetTargetResult;
    expect(targetA.ok).toBe(true);
    expect(targetA.staging_dir).toContain('mts-envA');

    // 2. stage a change in env A
    const stagedA = (await callTool(rig.registry, rig.container, 'add_debug_node', {
      tab_id: TAB_ID,
      source_node_id: INJECT_ID,
      opts: { label: 'Env A' },
    })) as StageResult;
    expect(stagedA.ok).toBe(true);
    const envAStagedHash = stagedA.staged_hash;

    // 3. clear_target (drops persisted target.json; doesn't auto-revert in-memory)
    await callTool(rig.registry, rig.container, 'clear_target', {
      env_name: 'mts-envA',
    });

    // 4. set_target(env B) — different env name → different state dirs
    const targetB = (await callTool(rig.registry, rig.container, 'set_target', {
      flow_source: 'file',
      file_path: flowsBPath,
      env_name: 'mts-envB',
      snapshot_dir: path.join(envBRoot, 'snapshots'),
      staging_dir: path.join(envBRoot, 'staging'),
      audit_log_path: path.join(envBRoot, 'audit.jsonl'),
      persist: false,
    })) as SetTargetResult;
    expect(targetB.ok).toBe(true);
    expect(targetB.staging_dir).toContain('mts-envB');
    expect(targetB.staging_dir).not.toBe(targetA.staging_dir);

    // 5. stage a different change in env B
    const stagedB = (await callTool(rig.registry, rig.container, 'add_inject_node', {
      tab_id: TAB_ID,
      opts: { label: 'Env B' },
    })) as StageResult;
    expect(stagedB.ok).toBe(true);
    expect(stagedB.staged_hash).not.toBe(envAStagedHash);

    // 6. assert env A staging file is intact (not clobbered by env B's stage)
    const envAStagedJsonPath = path.join(envARoot, 'staging', 'staged.json');
    const rawA = await readFile(envAStagedJsonPath, 'utf8');
    const parsedA = JSON.parse(rawA) as { stagedHash: string };
    expect(parsedA.stagedHash).toBe(envAStagedHash);

    // 7. assert env B staging file holds env B's hash and ONLY env B's hash
    const envBStagedJsonPath = path.join(envBRoot, 'staging', 'staged.json');
    const rawB = await readFile(envBStagedJsonPath, 'utf8');
    const parsedB = JSON.parse(rawB) as { stagedHash: string };
    expect(parsedB.stagedHash).toBe(stagedB.staged_hash);
    expect(parsedB.stagedHash).not.toBe(envAStagedHash);

    // 8. audit log isolation: env A audit log file exists separately
    //    from env B audit log file.
    const auditA = path.join(envARoot, 'audit.jsonl');
    const auditB = path.join(envBRoot, 'audit.jsonl');
    expect(auditA).not.toBe(auditB);
    const auditALines = (await readFile(auditA, 'utf8')).trim().split('\n');
    const auditBLines = (await readFile(auditB, 'utf8')).trim().split('\n');
    expect(auditALines.length).toBeGreaterThan(0);
    expect(auditBLines.length).toBeGreaterThan(0);
    // Cross-check: env A's lines should reference its env_name; same for B.
    const aRefsA = auditALines.some((line) => line.includes('mts-envA'));
    const bRefsB = auditBLines.some((line) => line.includes('mts-envB'));
    expect(aRefsA).toBe(true);
    expect(bRefsB).toBe(true);
  });
});
