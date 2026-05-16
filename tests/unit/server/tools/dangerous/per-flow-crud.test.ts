import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { NodeRedClient } from '../../../../../src/adapters/nodered/client.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { createFlowTool } from '../../../../../src/server/tools/dangerous/create-flow.js';
import { deleteFlowTool } from '../../../../../src/server/tools/dangerous/delete-flow.js';
import { dangerousToken } from '../../../../../src/server/tools/dangerous/_confirmation.js';
import { updateFlowTool } from '../../../../../src/server/tools/dangerous/update-flow.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const SAMPLE = [{ id: 'tab1', type: 'tab', label: 'Main' }];

let ctx: ToolContext;
let cleanup: () => Promise<void>;
let lastFetch: ReturnType<typeof vi.fn> | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  // HTTP 204/304 forbid a body — match real semantics.
  if (status === 204 || status === 304) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function buildCtx(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'crud-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(SAMPLE), 'utf8');

  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
  });
  const logger = createLogger({ level: 'silent' });

  lastFetch = vi.fn();
  const client = new NodeRedClient({
    baseUrl: 'http://localhost:1880',
    auth: new NoAuth(),
    fetchImpl: lastFetch,
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

describe('create_flow tool', () => {
  it('rejects when noderedClient is undefined (file-source target)', async () => {
    delete ctx.noderedClient;
    delete ctx.container.noderedClient;
    await expect(
      createFlowTool.handler({ flow: { label: 'X' }, confirmation_token: 'whatever' }, ctx),
    ).rejects.toThrow(/requires an admin-api target/);
  });

  it('rejects an invalid confirmation token', async () => {
    await expect(
      createFlowTool.handler({ flow: { label: 'X' }, confirmation_token: 'bogus' }, ctx),
    ).rejects.toThrow(/Invalid confirmation_token/);
  });

  it('snapshots runtime, calls POST /flow, and returns the created id', async () => {
    const flow = { label: 'New Tab', nodes: [] };
    const token = dangerousToken({
      operation: 'create_flow',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      target: 'New Tab',
      flowsHash: canonicalHash(flow),
    });
    lastFetch!.mockResolvedValueOnce(jsonResponse({ id: 'created-id-1' }));
    const out = await createFlowTool.handler({ flow, confirmation_token: token }, ctx);
    expect(out.ok).toBe(true);
    expect(out.created_id).toBe('created-id-1');
    expect(out.snapshot_before).toBeTruthy();
    expect(lastFetch).toHaveBeenCalledTimes(1);
    const [url, init] = lastFetch!.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/flow');
    expect(init.method).toBe('POST');
  });
});

describe('update_flow tool', () => {
  it('rejects an invalid token', async () => {
    await expect(
      updateFlowTool.handler(
        { flow_id: 'tab1', flow: { label: 'X' }, confirmation_token: 'bogus' },
        ctx,
      ),
    ).rejects.toThrow(/Invalid confirmation_token/);
  });

  it('snapshots runtime, calls PUT /flow/:id', async () => {
    const flow = { label: 'Updated', nodes: [] };
    const token = dangerousToken({
      operation: 'update_flow',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      target: 'tab1',
      flowsHash: canonicalHash(flow),
    });
    lastFetch!.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const out = await updateFlowTool.handler(
      { flow_id: 'tab1', flow, confirmation_token: token },
      ctx,
    );
    expect(out.ok).toBe(true);
    expect(out.updated_id).toBe('tab1');
    const [url, init] = lastFetch!.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/flow/tab1');
    expect(init.method).toBe('PUT');
  });
});

describe('delete_flow tool', () => {
  it('rejects an invalid token', async () => {
    await expect(
      deleteFlowTool.handler({ flow_id: 'tab1', confirmation_token: 'bogus' }, ctx),
    ).rejects.toThrow(/Invalid confirmation_token/);
  });

  it('snapshots runtime, calls DELETE /flow/:id', async () => {
    const token = dangerousToken({
      operation: 'delete_flow',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      target: 'tab1',
    });
    lastFetch!.mockResolvedValueOnce(jsonResponse({}, 204));
    const out = await deleteFlowTool.handler({ flow_id: 'tab1', confirmation_token: token }, ctx);
    expect(out.ok).toBe(true);
    expect(out.deleted_id).toBe('tab1');
    const [url, init] = lastFetch!.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/flow/tab1');
    expect(init.method).toBe('DELETE');
  });
});
