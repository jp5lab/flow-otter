/**
 * Failure-injection tests for `deploy_staged_change`. Exercises the four
 * non-happy-path code paths using a mocked FlowSource, without going near
 * Docker or a real Node-RED runtime:
 *
 *   (a) rev-mismatch 409 once + drift unchanged → retry succeeds
 *       (asserts `retried_on_rev_mismatch=true`).
 *   (b) network error during save + post-deploy verify-by-hash shows runtime
 *       matches staged → `recovered_from_partial=true`.
 *   (c) rev-mismatch 409 + refetched hash differs from base → DriftError.
 *   (d) baseline drift before deploy → DriftError unless `force=true`.
 *   (e) cross-process stage refused unless `force_takeover=true`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { RevMismatchError } from '../../../../../src/adapters/nodered/errors.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { deployStagedChangeTool } from '../../../../../src/server/tools/deploy/deploy-staged-change.js';
import type {
  FlowSource,
  FlowSourceDescriptor,
  FlowSourceFingerprint,
  FlowSourceWarning,
  SaveOptions,
} from '../../../../../src/shared/flow-source.js';
import type { FlowsJson } from '../../../../../src/shared/flows-json.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const BASE_FLOWS: FlowsJson = [{ id: 'tab1', type: 'tab', label: 'Main' }];
const NEXT_FLOWS: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [] },
];
const BASE_HASH = canonicalHash(BASE_FLOWS);
const STAGED_HASH = canonicalHash(NEXT_FLOWS);
const DRIFTED_FLOWS: FlowsJson = [{ id: 'tab1', type: 'tab', label: 'DIFFERENT' }];

interface MockFlowSourceOptions {
  loadFlows: () => Promise<{ flows: FlowsJson; rev: string | null }>;
  saveImpl: (flows: FlowsJson, opts: SaveOptions) => Promise<{ rev: string }>;
}

function mkMockFlowSource(opts: MockFlowSourceOptions): FlowSource {
  return {
    load: opts.loadFlows,
    save: opts.saveImpl,
    // eslint-disable-next-line @typescript-eslint/require-await
    async fingerprint(): Promise<FlowSourceFingerprint> {
      return { sha256: BASE_HASH, rev: 'rev-0' };
    },
    describe(): FlowSourceDescriptor {
      return { kind: 'adminapi', target: 'mock://localhost' };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async inspectWarnings(): Promise<readonly FlowSourceWarning[]> {
      return [];
    },
  };
}

let root: string;
let staging: StagedStore;
let cleanup: () => Promise<void>;

function buildCtx(opts: {
  flowSource: FlowSource;
  agentIdOverride?: string;
  envOverrides?: Record<string, string>;
}): ToolContext {
  const config = loadConfig({
    FLOW_SOURCE: 'admin-api',
    NODE_RED_BASE_URL: 'http://localhost:1880',
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_DEPLOY_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
    ALLOWED_DEPLOYMENT_MODES: 'nodes,flows,full',
    ...(opts.envOverrides ?? {}),
  });
  const logger = createLogger({ level: 'silent' });
  const containerFields = {
    config,
    flowSource: opts.flowSource,
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging,
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: (): Date => new Date('2026-05-01T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: opts.agentIdOverride ?? 'agent-A',
  };
  return {
    ...containerFields,
    enrichAudit: () => undefined,
    container: containerFields,
  };
}

async function stageChange(agentId: string): Promise<void> {
  await staging.write({
    flows: NEXT_FLOWS,
    basedOnSnapshotHash: BASE_HASH,
    basedOnRev: 'rev-0',
    stagedHash: STAGED_HASH,
    stagedAt: '2026-05-01T00:00:00.000Z',
    actor: 'unit-test',
    agent_id: agentId,
    reason: 'add_debug_node',
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'deploy-fi-'));
  staging = new StagedStore({ dir: path.join(root, 'staging') });
  cleanup = async () => {
    await rm(root, { recursive: true, force: true });
  };
});

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

describe('deploy_staged_change failure injection', () => {
  it('(a) RevMismatchError once + drift unchanged → retry succeeds with retried_on_rev_mismatch=true', async () => {
    await stageChange('agent-A');
    const saveImpl = vi
      .fn()
      .mockRejectedValueOnce(new RevMismatchError('rev-0', 'mock 409'))
      .mockResolvedValueOnce({ rev: 'rev-2' });
    let loadCallCount = 0;
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> => {
      loadCallCount += 1;
      // First call: pre-deploy load. Returns the base. Second call: post-409
      // refetch — still returns the base (drift unchanged), so retry succeeds.
      return Promise.resolve({ flows: BASE_FLOWS, rev: loadCallCount === 1 ? 'rev-0' : 'rev-1' });
    };
    const ctx = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
    });
    const out = (await deployStagedChangeTool.handler({ staged_hash: STAGED_HASH }, ctx)) as {
      ok: boolean;
      retried_on_rev_mismatch: boolean;
      recovered_from_partial: boolean;
      rev_after: string | null;
    };
    expect(out.ok).toBe(true);
    expect(out.retried_on_rev_mismatch).toBe(true);
    expect(out.recovered_from_partial).toBe(false);
    expect(out.rev_after).toBe('rev-2');
    expect(saveImpl).toHaveBeenCalledTimes(2);
  });

  it('(b) network error during save + post-deploy verify shows runtime matches → recovered_from_partial=true', async () => {
    await stageChange('agent-A');
    const saveImpl = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET mid-flight'));
    let loadCallCount = 0;
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> => {
      loadCallCount += 1;
      // First call: pre-deploy → BASE. Second call (post-error verify): runtime
      // now matches our staged content (the save DID succeed server-side).
      if (loadCallCount === 1) return Promise.resolve({ flows: BASE_FLOWS, rev: 'rev-0' });
      return Promise.resolve({ flows: NEXT_FLOWS, rev: 'rev-1' });
    };
    const ctx = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
    });
    const out = (await deployStagedChangeTool.handler({ staged_hash: STAGED_HASH }, ctx)) as {
      ok: boolean;
      recovered_from_partial: boolean;
      retried_on_rev_mismatch: boolean;
      rev_after: string | null;
    };
    expect(out.ok).toBe(true);
    expect(out.recovered_from_partial).toBe(true);
    expect(out.retried_on_rev_mismatch).toBe(false);
    expect(out.rev_after).toBe('rev-1');
  });

  it('(c) RevMismatchError + refetched hash differs → throws DriftError', async () => {
    await stageChange('agent-A');
    const saveImpl = vi.fn().mockRejectedValueOnce(new RevMismatchError('rev-0', 'mock 409'));
    let loadCallCount = 0;
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> => {
      loadCallCount += 1;
      // First call: pre-deploy → BASE. Second call: refetch finds NEW drifted
      // content (someone else changed the runtime concurrently).
      if (loadCallCount === 1) return Promise.resolve({ flows: BASE_FLOWS, rev: 'rev-0' });
      return Promise.resolve({ flows: DRIFTED_FLOWS, rev: 'rev-1' });
    };
    const ctx = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
    });
    await expect(deployStagedChangeTool.handler({ staged_hash: STAGED_HASH }, ctx)).rejects.toThrow(
      /mock 409/,
    );
  });

  it('(d) drift before deploy → DriftError; force=true overrides and succeeds', async () => {
    await stageChange('agent-A');
    const driftedHash = canonicalHash(DRIFTED_FLOWS);
    // Pre-deploy load shows drift (hash != staged.basedOnSnapshotHash).
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> =>
      Promise.resolve({ flows: DRIFTED_FLOWS, rev: 'rev-DRIFT' });
    const saveImpl = vi.fn().mockResolvedValue({ rev: 'rev-after-force' });
    const ctx1 = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
    });
    await expect(
      deployStagedChangeTool.handler({ staged_hash: STAGED_HASH }, ctx1),
    ).rejects.toThrow(/drifted/i);
    expect(saveImpl).not.toHaveBeenCalled();
    expect(driftedHash).not.toBe(BASE_HASH);

    // Same scenario with force=true should bypass the drift check.
    const ctx2 = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
    });
    const out = (await deployStagedChangeTool.handler(
      { staged_hash: STAGED_HASH, force: true },
      ctx2,
    )) as { ok: boolean; forced: boolean };
    expect(out.ok).toBe(true);
    expect(out.forced).toBe(true);
  });

  it('(f) REQUIRE_DIFF_BEFORE_DEPLOY=true refuses no-op deploy (staged equals runtime)', async () => {
    // Stage a change whose stagedHash matches the runtime hash → no diff.
    await staging.write({
      flows: BASE_FLOWS,
      basedOnSnapshotHash: BASE_HASH,
      basedOnRev: 'rev-0',
      stagedHash: BASE_HASH,
      stagedAt: '2026-05-01T00:00:00.000Z',
      actor: 'unit-test',
      agent_id: 'agent-A',
      reason: 'no-op',
    });
    const saveImpl = vi.fn();
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> =>
      Promise.resolve({ flows: BASE_FLOWS, rev: 'rev-0' });
    const ctx = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
    });
    await expect(deployStagedChangeTool.handler({ staged_hash: BASE_HASH }, ctx)).rejects.toThrow(
      /no diff vs the runtime/i,
    );
    expect(saveImpl).not.toHaveBeenCalled();
  });

  it('(g) REQUIRE_DIFF_BEFORE_DEPLOY=false allows no-op deploy', async () => {
    await staging.write({
      flows: BASE_FLOWS,
      basedOnSnapshotHash: BASE_HASH,
      basedOnRev: 'rev-0',
      stagedHash: BASE_HASH,
      stagedAt: '2026-05-01T00:00:00.000Z',
      actor: 'unit-test',
      agent_id: 'agent-A',
      reason: 'no-op',
    });
    const saveImpl = vi.fn().mockResolvedValue({ rev: 'rev-noop' });
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> =>
      Promise.resolve({ flows: BASE_FLOWS, rev: 'rev-0' });
    const ctx = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
      envOverrides: { REQUIRE_DIFF_BEFORE_DEPLOY: 'false' },
    });
    const out = (await deployStagedChangeTool.handler({ staged_hash: BASE_HASH }, ctx)) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
    expect(saveImpl).toHaveBeenCalledTimes(1);
  });

  it('(h) REQUIRE_SNAPSHOT_BEFORE_DEPLOY=false skips pre-deploy snapshot and returns snapshot_before:null', async () => {
    await stageChange('agent-A');
    const saveImpl = vi.fn().mockResolvedValue({ rev: 'rev-1' });
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> =>
      Promise.resolve({ flows: BASE_FLOWS, rev: 'rev-0' });
    const ctx = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
      envOverrides: { REQUIRE_SNAPSHOT_BEFORE_DEPLOY: 'false' },
    });
    const out = (await deployStagedChangeTool.handler({ staged_hash: STAGED_HASH }, ctx)) as {
      ok: boolean;
      snapshot_before: string | null;
    };
    expect(out.ok).toBe(true);
    expect(out.snapshot_before).toBeNull();
  });

  it('(e) cross-process stage refused unless force_takeover=true', async () => {
    await stageChange('agent-OTHER');
    const saveImpl = vi.fn().mockResolvedValue({ rev: 'rev-1' });
    const loadImpl = (): Promise<{ flows: FlowsJson; rev: string | null }> =>
      Promise.resolve({ flows: BASE_FLOWS, rev: 'rev-0' });

    const ctx1 = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
      agentIdOverride: 'agent-A',
    });
    await expect(
      deployStagedChangeTool.handler({ staged_hash: STAGED_HASH }, ctx1),
    ).rejects.toThrow(/authored by a different agent/i);
    expect(saveImpl).not.toHaveBeenCalled();

    // With force_takeover, deploy should succeed and report takeover=true.
    const ctx2 = buildCtx({
      flowSource: mkMockFlowSource({ loadFlows: loadImpl, saveImpl }),
      agentIdOverride: 'agent-A',
    });
    const out = (await deployStagedChangeTool.handler(
      { staged_hash: STAGED_HASH, force_takeover: true },
      ctx2,
    )) as { ok: boolean; takeover: boolean };
    expect(out.ok).toBe(true);
    expect(out.takeover).toBe(true);
  });
});
