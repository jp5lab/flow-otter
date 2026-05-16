import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContainer, rehydrateFromPersistedTarget } from '../../../src/server/container.js';
import { writePersistedTarget } from '../../../src/server/state/persisted-target.js';

let homeDir: string;
let workRoot: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(os.tmpdir(), 'rehydrate-home-'));
  workRoot = await mkdtemp(path.join(os.tmpdir(), 'rehydrate-work-'));
  process.env.HOME = homeDir;
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  await rm(workRoot, { recursive: true, force: true });
});

describe('rehydrateFromPersistedTarget', () => {
  it('rehydrates an admin-api target when no explicit env vars are set', async () => {
    await writePersistedTarget(
      'production',
      { flow_source: 'admin-api', base_url: 'http://192.0.2.10:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const container = buildContainer({
      env: { ENVIRONMENT_NAME: 'production', LOG_LEVEL: 'silent' },
      serverVersion: '0.0.0-test',
    });
    expect(container.flowSource.describe().kind).toBe('adminapi');

    const result = await rehydrateFromPersistedTarget(container, {
      ENVIRONMENT_NAME: 'production',
    });

    expect(result.rehydrated).toBe(true);
    expect(result.applied?.flow_source).toBe('admin-api');
    expect(result.applied?.base_url).toBe('http://192.0.2.10:1880');
    expect(container.flowSource.describe()).toEqual({
      kind: 'adminapi',
      target: 'http://192.0.2.10:1880',
    });
  });

  it('rehydrates a file target when no explicit env vars are set', async () => {
    const targetFlows = path.join(workRoot, 'flows.json');
    await writeFile(targetFlows, JSON.stringify([]), 'utf8');

    await writePersistedTarget(
      'project-x',
      { flow_source: 'file', file_path: targetFlows },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const container = buildContainer({
      env: { ENVIRONMENT_NAME: 'project-x', LOG_LEVEL: 'silent' },
      serverVersion: '0.0.0-test',
    });

    const result = await rehydrateFromPersistedTarget(container, {
      ENVIRONMENT_NAME: 'project-x',
    });

    expect(result.rehydrated).toBe(true);
    expect(result.applied?.flow_source).toBe('file');
    expect(container.config.FLOW_FILE_PATH).toBe(targetFlows);
  });

  it('skips rehydration when NODE_RED_BASE_URL is set', async () => {
    await writePersistedTarget(
      'pinned',
      { flow_source: 'admin-api', base_url: 'http://from-disk:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const container = buildContainer({
      env: {
        ENVIRONMENT_NAME: 'pinned',
        NODE_RED_BASE_URL: 'http://from-env:1880',
        LOG_LEVEL: 'silent',
      },
      serverVersion: '0.0.0-test',
    });
    const result = await rehydrateFromPersistedTarget(container, {
      ENVIRONMENT_NAME: 'pinned',
      NODE_RED_BASE_URL: 'http://from-env:1880',
    });
    expect(result.rehydrated).toBe(false);
    expect(result.skipped_because).toBe('explicit-base-url');
    expect(container.config.NODE_RED_BASE_URL).toBe('http://from-env:1880');
  });

  it('skips rehydration when FLOW_FILE_PATH is set', async () => {
    const explicitPath = path.join(workRoot, 'pinned-flows.json');
    await writeFile(explicitPath, JSON.stringify([]), 'utf8');

    await writePersistedTarget(
      'pinned-file',
      { flow_source: 'file', file_path: '/tmp/from-disk.json' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const container = buildContainer({
      env: {
        ENVIRONMENT_NAME: 'pinned-file',
        FLOW_SOURCE: 'file',
        FLOW_FILE_PATH: explicitPath,
        LOG_LEVEL: 'silent',
      },
      serverVersion: '0.0.0-test',
    });
    const result = await rehydrateFromPersistedTarget(container, {
      ENVIRONMENT_NAME: 'pinned-file',
      FLOW_FILE_PATH: explicitPath,
    });
    expect(result.rehydrated).toBe(false);
    expect(result.skipped_because).toBe('explicit-file-path');
    expect(container.config.FLOW_FILE_PATH).toBe(explicitPath);
  });

  it('returns rehydrated:false (no skip reason) when no target.json exists', async () => {
    const container = buildContainer({
      env: { ENVIRONMENT_NAME: 'fresh', LOG_LEVEL: 'silent' },
      serverVersion: '0.0.0-test',
    });
    const result = await rehydrateFromPersistedTarget(container, {
      ENVIRONMENT_NAME: 'fresh',
    });
    expect(result.rehydrated).toBe(false);
    expect(result.skipped_because).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('isolates parallel env_names — one env_name does not contaminate another', async () => {
    await writePersistedTarget(
      'session-a',
      { flow_source: 'admin-api', base_url: 'http://host-a:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    await writePersistedTarget(
      'session-b',
      { flow_source: 'admin-api', base_url: 'http://host-b:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );

    const containerA = buildContainer({
      env: { ENVIRONMENT_NAME: 'session-a', LOG_LEVEL: 'silent' },
      serverVersion: '0.0.0-test',
    });
    const containerB = buildContainer({
      env: { ENVIRONMENT_NAME: 'session-b', LOG_LEVEL: 'silent' },
      serverVersion: '0.0.0-test',
    });

    const [resA, resB] = await Promise.all([
      rehydrateFromPersistedTarget(containerA, { ENVIRONMENT_NAME: 'session-a' }),
      rehydrateFromPersistedTarget(containerB, { ENVIRONMENT_NAME: 'session-b' }),
    ]);

    expect(resA.applied?.base_url).toBe('http://host-a:1880');
    expect(resB.applied?.base_url).toBe('http://host-b:1880');
    expect(containerA.config.NODE_RED_BASE_URL).toBe('http://host-a:1880');
    expect(containerB.config.NODE_RED_BASE_URL).toBe('http://host-b:1880');
  });

  it('surfaces warnings when target.json is corrupt without crashing', async () => {
    const { mkdir, writeFile: wf } = await import('node:fs/promises');
    const dir = path.join(homeDir, '.flow-otter', 'corrupt-env');
    await mkdir(dir, { recursive: true });
    await wf(path.join(dir, 'target.json'), 'not-json{', 'utf8');

    const container = buildContainer({
      env: { ENVIRONMENT_NAME: 'corrupt-env', LOG_LEVEL: 'silent' },
      serverVersion: '0.0.0-test',
    });
    const result = await rehydrateFromPersistedTarget(container, {
      ENVIRONMENT_NAME: 'corrupt-env',
    });
    expect(result.rehydrated).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('parse-error');
  });
});
