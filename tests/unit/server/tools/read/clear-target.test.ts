import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { Container } from '../../../../../src/server/container.js';
import {
  readPersistedTarget,
  writePersistedTarget,
} from '../../../../../src/server/state/persisted-target.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { clearTargetTool } from '../../../../../src/server/tools/read/clear-target.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

let root: string;
let homeDir: string;
let container: Container;
let ctx: ToolContext;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'clear-target-'));
  homeDir = await mkdtemp(path.join(os.tmpdir(), 'clear-target-home-'));
  process.env.HOME = homeDir;
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify([]), 'utf8');

  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
    REQUEST_TIMEOUT_MS: '100',
  });
  const logger = createLogger({ level: 'silent' });
  container = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging: new StagedStore({ dir: config.STAGING_DIR }),
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: () => new Date('2026-05-08T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  ctx = {
    ...container,
    enrichAudit: () => undefined,
    container,
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

describe('clear_target tool', () => {
  it('removes target.json for the current ENVIRONMENT_NAME', async () => {
    await writePersistedTarget(
      'unit',
      { flow_source: 'admin-api', base_url: 'http://example:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );

    const result = (await clearTargetTool.handler({}, ctx)) as {
      ok: boolean;
      env_name: string;
      removed: boolean;
      reverted_in_memory: boolean;
    };

    expect(result.ok).toBe(true);
    expect(result.env_name).toBe('unit');
    expect(result.removed).toBe(true);
    expect(result.reverted_in_memory).toBe(false);

    const after = await readPersistedTarget('unit');
    expect(after.target).toBeNull();
  });

  it('returns removed:false when no target.json exists', async () => {
    const result = (await clearTargetTool.handler({}, ctx)) as { removed: boolean };
    expect(result.removed).toBe(false);
  });

  it('clears a specified env_name independent of the live ENVIRONMENT_NAME', async () => {
    await writePersistedTarget(
      'other-env',
      { flow_source: 'file', file_path: '/tmp/foo.json' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );

    const result = (await clearTargetTool.handler({ env_name: 'other-env' }, ctx)) as {
      env_name: string;
      removed: boolean;
    };
    expect(result.env_name).toBe('other-env');
    expect(result.removed).toBe(true);
  });

  it('reverts the live container to a file source when revert_in_memory is true', async () => {
    const revertPath = path.join(root, 'fallback-flows.json');
    await writeFile(revertPath, JSON.stringify([]), 'utf8');

    const result = (await clearTargetTool.handler(
      { revert_in_memory: true, revert_file_path: revertPath },
      ctx,
    )) as { reverted_in_memory: boolean };

    expect(result.reverted_in_memory).toBe(true);
    expect(container.flowSource.describe()).toEqual({ kind: 'file', target: revertPath });
  });

  it('is registered as a read-tier tool', () => {
    expect(clearTargetTool.tier).toBe('read');
  });
});
