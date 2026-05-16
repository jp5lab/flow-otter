/**
 * Integration tests for the v0.4.0 persistence + rehydration story.
 *
 * Covers:
 * - Per-env_name state-directory isolation when two containers point at the
 *   same Node-RED with different env_names.
 * - target.json is written after a successful `set_target` call.
 * - A second container booted with the same ENVIRONMENT_NAME (simulating a
 *   process restart) rehydrates the persisted target without re-calling
 *   `set_target`.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildContainer,
  persistAppliedTarget,
  rehydrateFromPersistedTarget,
} from '../../src/server/container.js';
import { persistedTargetPath } from '../../src/server/state/persisted-target.js';
import { applyTarget } from '../../src/server/container.js';

const NR_BASE = process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880';

let homeDir: string;
let stateRoot: string;

beforeAll(async () => {
  homeDir = await mkdtemp(path.join(tmpdir(), 'flow-otter-int-home-'));
  process.env.HOME = homeDir;
  stateRoot = path.join(homeDir, '.flow-otter');
});

afterAll(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('persisted target — end-to-end against real Node-RED', () => {
  it('writes target.json after set_target + applyTarget against a live runtime', async () => {
    const container = buildContainer({
      env: {
        ENVIRONMENT_NAME: 'int-persist-1',
        LOG_LEVEL: 'silent',
      },
      serverVersion: '0.6.0-int',
    });
    const applied = applyTarget(container, {
      kind: 'admin-api',
      base_url: NR_BASE,
      env_name: 'int-persist-1',
    });
    await persistAppliedTarget(applied);

    const onDisk = path.join(stateRoot, 'int-persist-1', 'target.json');
    expect(onDisk).toBe(persistedTargetPath('int-persist-1'));
    const raw = await readFile(onDisk, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schema_version: 1,
      env_name: 'int-persist-1',
      flow_source: 'admin-api',
      base_url: NR_BASE,
    });
    // Hard rule: auth tokens MUST NOT be in the persisted target.
    expect(parsed).not.toHaveProperty('auth_token');
    expect(parsed).not.toHaveProperty('password');

    // The live target is reachable — admin-api flow source can fetch.
    const fp = await container.flowSource.fingerprint();
    expect(typeof fp).toBe('object');
  });

  it('isolates two env_names sharing the same Node-RED base_url', async () => {
    const cA = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-iso-a', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const cB = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-iso-b', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const aApplied = applyTarget(cA, {
      kind: 'admin-api',
      base_url: NR_BASE,
      env_name: 'int-iso-a',
    });
    const bApplied = applyTarget(cB, {
      kind: 'admin-api',
      base_url: NR_BASE,
      env_name: 'int-iso-b',
    });
    await persistAppliedTarget(aApplied);
    await persistAppliedTarget(bApplied);

    // State directories diverge — no shared snapshot/staging/audit paths.
    expect(cA.config.SNAPSHOT_DIR).not.toBe(cB.config.SNAPSHOT_DIR);
    expect(cA.config.STAGING_DIR).not.toBe(cB.config.STAGING_DIR);
    expect(cA.config.AUDIT_LOG_PATH).not.toBe(cB.config.AUDIT_LOG_PATH);

    // Both target.json files exist and contain their respective env_names.
    const rawA = JSON.parse(await readFile(persistedTargetPath('int-iso-a'), 'utf8')) as Record<
      string,
      unknown
    >;
    const rawB = JSON.parse(await readFile(persistedTargetPath('int-iso-b'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(rawA['env_name']).toBe('int-iso-a');
    expect(rawB['env_name']).toBe('int-iso-b');
  });

  it('rehydrates an admin-api target on second container boot (simulates restart)', async () => {
    // Container A: set_target + persist
    const cA = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-rehydrate', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const aApplied = applyTarget(cA, {
      kind: 'admin-api',
      base_url: NR_BASE,
      env_name: 'int-rehydrate',
    });
    await persistAppliedTarget(aApplied);

    // Container B: fresh boot, same ENVIRONMENT_NAME, no NODE_RED_BASE_URL env.
    // Should rehydrate from the on-disk target.json A wrote.
    const cB = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-rehydrate', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    expect(cB.config.NODE_RED_BASE_URL).toBeUndefined();
    const result = await rehydrateFromPersistedTarget(cB, {
      ENVIRONMENT_NAME: 'int-rehydrate',
    });
    expect(result.rehydrated).toBe(true);
    expect(result.applied?.base_url).toBe(NR_BASE);
    expect(cB.config.NODE_RED_BASE_URL).toBe(NR_BASE);

    // The rehydrated container can talk to Node-RED.
    expect(await cB.flowSource.fingerprint()).toBeTruthy();
  });

  it('explicit NODE_RED_BASE_URL suppresses rehydration', async () => {
    // Pre-seed a persisted target with a different URL.
    const cSeed = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-pinned', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const seedApplied = applyTarget(cSeed, {
      kind: 'admin-api',
      base_url: 'http://from-disk:9999',
      env_name: 'int-pinned',
    });
    await persistAppliedTarget(seedApplied);

    // Boot a new container with NODE_RED_BASE_URL set explicitly — should win.
    const cPinned = buildContainer({
      env: {
        ENVIRONMENT_NAME: 'int-pinned',
        NODE_RED_BASE_URL: NR_BASE,
        LOG_LEVEL: 'silent',
      },
      serverVersion: '0.6.0-int',
    });
    const result = await rehydrateFromPersistedTarget(cPinned, {
      ENVIRONMENT_NAME: 'int-pinned',
      NODE_RED_BASE_URL: NR_BASE,
    });
    expect(result.rehydrated).toBe(false);
    expect(result.skipped_because).toBe('explicit-base-url');
    expect(cPinned.config.NODE_RED_BASE_URL).toBe(NR_BASE);
  });
});
