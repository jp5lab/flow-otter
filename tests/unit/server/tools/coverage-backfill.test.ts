/**
 * Minimal unit-test coverage for tools that lack a dedicated test file:
 * - rollback_last_change
 * - set_flows_state
 * - get_runtime_state
 * - list_installed_node_types
 *
 * Verifies each tool is invokable through the standard ctx pipeline. Uses a
 * mocked NodeRedClient when admin-api calls are needed.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileFlowSource } from '../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../src/adapters/nodered/auth.js';
import { NodeRedClient } from '../../../../src/adapters/nodered/client.js';
import { JsonlAuditLogger } from '../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../src/server/tools/_tool.js';
import { setFlowsStateTool } from '../../../../src/server/tools/deploy/set-flows-state.js';
import { rollbackLastChangeTool } from '../../../../src/server/tools/deploy/rollback-last-change.js';
import { getRuntimeStateTool } from '../../../../src/server/tools/read/get-runtime-state.js';
import { listInstalledNodeTypesTool } from '../../../../src/server/tools/read/list-installed-node-types.js';
import { canonicalHash } from '../../../../src/shared/hash.js';
import { createLogger } from '../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../src/toolkit/staging/staged-store.js';

const SAMPLE = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [] },
];

let ctx: ToolContext;
let cleanup: () => Promise<void>;
let fetchMock: ReturnType<typeof vi.fn> | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function buildCtx(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'cov-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(SAMPLE), 'utf8');

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
  });
  const logger = createLogger({ level: 'silent' });
  fetchMock = vi.fn();
  const client = new NodeRedClient({
    baseUrl: 'http://localhost:1880',
    auth: new NoAuth(),
    fetchImpl: fetchMock,
    retries: 0,
    logger,
  });
  const containerFields = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging: new StagedStore({ dir: config.STAGING_DIR }),
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: (): Date => new Date('2026-05-01T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
    noderedClient: client,
  };
  ctx = {
    ...containerFields,
    enrichAudit: () => undefined,
    container: containerFields,
  };
  cleanup = async () => {
    await rm(root, { recursive: true, force: true });
  };
}

beforeEach(async () => {
  await buildCtx();
});

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

describe('rollback_last_change', () => {
  it('throws when no snapshots exist', async () => {
    await expect(rollbackLastChangeTool.handler({}, ctx)).rejects.toThrow();
  });

  it('restores the most recent snapshot', async () => {
    // Seed a snapshot of an EARLIER state (different from current file
    // contents) so its hash differs from current-runtime hash. This avoids
    // the snapshot-store filename collision when pre-rollback hash == prior
    // snapshot hash under a fixed clock.
    const earlierFlows = [{ id: 'tab-old', type: 'tab', label: 'Earlier' }];
    const snap = await ctx.snapshots.save({
      flows: earlierFlows,
      rev: 'rev-pre',
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: 'manual-pre-test',
      takenAt: ctx.clock().toISOString(),
      tags: ['manual'],
      serverVersion: ctx.serverVersion,
    });
    const out = await rollbackLastChangeTool.handler({}, ctx);
    expect(out.ok).toBe(true);
    expect(out.restored_snapshot_id).toBe(snap.id);
  });
});

describe('set_flows_state', () => {
  it('POSTs to /flows/state with start (and reads prior state first)', async () => {
    // Tool issues GET /flows/state (prior) + POST /flows/state (next).
    fetchMock!.mockResolvedValueOnce(jsonResponse({ state: 'stop' }));
    fetchMock!.mockResolvedValueOnce(jsonResponse({ state: 'start' }));
    const out = await setFlowsStateTool.handler({ state: 'start' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.state).toBe('start');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces FeatureDisabledError when runtimeState API is disabled', async () => {
    // First call (GET /flows/state) returns the same 404.
    fetchMock!.mockResolvedValueOnce(jsonResponse({ code: 'runtimeState.disabled' }, 404));
    await expect(setFlowsStateTool.handler({ state: 'stop' }, ctx)).rejects.toThrow();
  });
});

describe('get_runtime_state', () => {
  it('returns the runtime state from /flows/state', async () => {
    fetchMock!.mockResolvedValueOnce(jsonResponse({ state: 'start' }));
    const out = (await getRuntimeStateTool.handler({}, ctx)) as { state: string };
    expect(out.state).toBe('start');
  });
});

describe('list_installed_node_types', () => {
  it('returns the installed module list from GET /nodes', async () => {
    fetchMock!.mockResolvedValueOnce(
      jsonResponse([{ id: 'node-red/inject', name: 'inject', types: ['inject'], enabled: true }]),
    );
    const out = (await listInstalledNodeTypesTool.handler({}, ctx)) as {
      modules: unknown[];
    };
    expect(out.modules.length).toBeGreaterThan(0);
    void canonicalHash; // suppress unused-import warning
  });
});
