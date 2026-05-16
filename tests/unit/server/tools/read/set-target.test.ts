import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import { applyTarget, type Container } from '../../../../../src/server/container.js';
import { persistedTargetPath } from '../../../../../src/server/state/persisted-target.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { setTargetTool } from '../../../../../src/server/tools/read/set-target.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

let root: string;
let homeDir: string;
let container: Container;
let ctx: ToolContext;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'set-target-'));
  homeDir = await mkdtemp(path.join(os.tmpdir(), 'set-target-home-'));
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

describe('applyTarget(admin-api)', () => {
  it('switches flow source from file to admin-api and re-scopes state dirs', () => {
    expect(container.flowSource.describe()).toEqual({
      kind: 'file',
      target: expect.any(String) as unknown,
    });

    const applied = applyTarget(container, {
      kind: 'admin-api',
      base_url: 'http://192.0.2.10:1880',
    });

    expect(applied.base_url).toBe('http://192.0.2.10:1880');
    expect(applied.env_name).toBe('192_0_2_10_1880');
    expect(applied.flow_source).toBe('admin-api');
    expect(container.config.FLOW_SOURCE).toBe('admin-api');
    expect(container.config.NODE_RED_BASE_URL).toBe('http://192.0.2.10:1880');
    expect(container.flowSource.describe()).toEqual({
      kind: 'adminapi',
      target: 'http://192.0.2.10:1880',
    });
    expect(container.noderedClient).toBeDefined();
    expect(applied.snapshot_dir).toContain(path.join('.flow-otter', '192_0_2_10_1880'));
    expect(applied.audit_log_path).toContain('audit.jsonl');
  });

  it('honours an explicit env_name', () => {
    const applied = applyTarget(container, {
      kind: 'admin-api',
      base_url: 'http://192.0.2.10:1880',
      env_name: 'production',
    });
    expect(applied.env_name).toBe('production');
    expect(container.config.ENVIRONMENT_NAME).toBe('production');
    expect(applied.snapshot_dir).toContain(path.join('.flow-otter', 'production'));
  });

  it('honours explicit state-path overrides', () => {
    const applied = applyTarget(container, {
      kind: 'admin-api',
      base_url: 'http://localhost:1880',
      snapshot_dir: '/tmp/custom/snapshots',
      staging_dir: '/tmp/custom/staging',
      audit_log_path: '/tmp/custom/audit.jsonl',
    });
    expect(applied.snapshot_dir).toBe('/tmp/custom/snapshots');
    expect(applied.staging_dir).toBe('/tmp/custom/staging');
    expect(applied.audit_log_path).toBe('/tmp/custom/audit.jsonl');
  });

  it('rejects non-http(s) URLs', () => {
    expect(() =>
      applyTarget(container, { kind: 'admin-api', base_url: 'ftp://example.com' }),
    ).toThrow(/must use http\(s\)/);
  });

  it('rejects malformed URLs', () => {
    expect(() => applyTarget(container, { kind: 'admin-api', base_url: 'not a url' })).toThrow(
      /Invalid base_url/,
    );
  });
});

describe('applyTarget(file)', () => {
  it('switches to a file source and re-scopes state dirs', async () => {
    const targetFlows = path.join(root, 'other-flows.json');
    await writeFile(targetFlows, JSON.stringify([]), 'utf8');

    const applied = applyTarget(container, { kind: 'file', file_path: targetFlows });

    expect(applied.flow_source).toBe('file');
    expect(applied.file_path).toBe(targetFlows);
    expect(container.config.FLOW_SOURCE).toBe('file');
    expect(container.config.FLOW_FILE_PATH).toBe(targetFlows);
    expect(container.flowSource.describe()).toEqual({
      kind: 'file',
      target: targetFlows,
    });
    expect(container.noderedClient).toBeUndefined();
    expect(applied.env_name).toMatch(/^[a-zA-Z0-9_-]+_[a-f0-9]{6}$/);
    expect(applied.snapshot_dir).toContain(path.join('.flow-otter', applied.env_name));
  });

  it('honours an explicit env_name in file mode', async () => {
    const targetFlows = path.join(root, 'flows-2.json');
    await writeFile(targetFlows, JSON.stringify([]), 'utf8');

    const applied = applyTarget(container, {
      kind: 'file',
      file_path: targetFlows,
      env_name: 'lab-bender',
    });
    expect(applied.env_name).toBe('lab-bender');
    expect(container.config.ENVIRONMENT_NAME).toBe('lab-bender');
  });

  it('resolves relative file paths to absolute', () => {
    const applied = applyTarget(container, { kind: 'file', file_path: 'relative/flows.json' });
    expect(path.isAbsolute(applied.file_path!)).toBe(true);
  });
});

describe('set_target tool — admin-api', () => {
  it('mutates container via ctx.container so subsequent calls see the new target', async () => {
    const result = (await setTargetTool.handler({ base_url: 'http://192.0.2.10:1880' }, ctx)) as {
      ok: boolean;
      env_name: string;
      flow_source: string;
      reachable: boolean;
      persisted: boolean;
      persisted_target_path?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.env_name).toBe('192_0_2_10_1880');
    expect(result.flow_source).toBe('admin-api');
    expect(result.reachable).toBe(false);
    expect(container.flowSource.describe().kind).toBe('adminapi');
    expect(container.config.NODE_RED_BASE_URL).toBe('http://192.0.2.10:1880');
  });

  it('persists target.json by default', async () => {
    await setTargetTool.handler({ base_url: 'http://192.0.2.10:1880' }, ctx);

    const persistedPath = persistedTargetPath('192_0_2_10_1880');
    const raw = await readFile(persistedPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schema_version: 1,
      env_name: '192_0_2_10_1880',
      flow_source: 'admin-api',
      base_url: 'http://192.0.2.10:1880',
    });
    expect(parsed).not.toHaveProperty('auth_token');
    expect(parsed).not.toHaveProperty('password');
  });

  it('persist:false skips the on-disk write', async () => {
    await setTargetTool.handler({ base_url: 'http://192.0.2.10:1880', persist: false }, ctx);
    const persistedPath = persistedTargetPath('192_0_2_10_1880');
    await expect(readFile(persistedPath, 'utf8')).rejects.toThrow();
  });

  it('rejects username without password', async () => {
    await expect(
      setTargetTool.inputZod.parseAsync({
        base_url: 'http://localhost:1880',
        username: 'admin',
      }),
    ).rejects.toThrow(/username and password must be supplied together/);
  });
});

describe('set_target tool — file', () => {
  it('switches to a file target and writes target.json', async () => {
    const targetFlows = path.join(root, 'persisted-flows.json');
    await writeFile(targetFlows, JSON.stringify([]), 'utf8');

    const result = (await setTargetTool.handler(
      { flow_source: 'file', file_path: targetFlows, env_name: 'test-env' },
      ctx,
    )) as {
      ok: boolean;
      env_name: string;
      flow_source: string;
      file_path?: string;
      persisted: boolean;
    };

    expect(result.ok).toBe(true);
    expect(result.flow_source).toBe('file');
    expect(result.env_name).toBe('test-env');
    expect(result.file_path).toBe(targetFlows);
    expect(result.persisted).toBe(true);
    expect(container.flowSource.describe()).toEqual({
      kind: 'file',
      target: targetFlows,
    });

    const persistedPath = persistedTargetPath('test-env');
    const raw = await readFile(persistedPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schema_version: 1,
      env_name: 'test-env',
      flow_source: 'file',
      file_path: targetFlows,
    });
  });
});

describe('set_target tool — registration', () => {
  it('is registered as a read-tier tool (always available)', () => {
    expect(setTargetTool.tier).toBe('read');
  });
});
