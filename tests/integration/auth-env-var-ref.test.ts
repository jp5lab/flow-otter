/**
 * Integration test for the v0.5.0 auth-env-var-ref scheme.
 *
 * The persistence layer never writes auth tokens to disk. Instead, callers
 * supply `auth_env_var` (a process-env variable name); the value is read at
 * apply time AND at boot-time rehydration without ever touching target.json.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildContainer,
  persistAppliedTarget,
  rehydrateFromPersistedTarget,
  applyTarget,
} from '../../src/server/container.js';
import { persistedTargetPath } from '../../src/server/state/persisted-target.js';

const NR_BASE = process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880';
const TOKEN_ENV_VAR = 'FLOWOTTER_INT_TEST_TOKEN';
const TOKEN_VALUE = 'fake-bearer-token-do-not-persist-me';

let homeDir: string;

beforeAll(async () => {
  homeDir = await mkdtemp(path.join(tmpdir(), 'flow-otter-int-auth-'));
  process.env.HOME = homeDir;
  process.env[TOKEN_ENV_VAR] = TOKEN_VALUE;
});

afterAll(async () => {
  delete process.env[TOKEN_ENV_VAR];
  await rm(homeDir, { recursive: true, force: true });
});

describe('auth env-var-ref scheme', () => {
  it('persists the env-var NAME, never the token VALUE, in target.json', async () => {
    const container = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-auth-ref', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const applied = applyTarget(container, {
      kind: 'admin-api',
      base_url: NR_BASE,
      env_name: 'int-auth-ref',
      auth_token: TOKEN_VALUE,
    });
    await persistAppliedTarget(applied, { auth_env_var: TOKEN_ENV_VAR });

    const raw = await readFile(persistedTargetPath('int-auth-ref'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // The variable NAME is stored.
    expect(parsed['auth_env_var']).toBe(TOKEN_ENV_VAR);

    // The token VALUE is NOT stored anywhere on disk.
    expect(raw).not.toContain(TOKEN_VALUE);
    expect(parsed).not.toHaveProperty('auth_token');
    expect(parsed).not.toHaveProperty('password');
  });

  it('rehydration reads the env var at boot to populate auth', async () => {
    // Seed via container A (already done in test above; for isolation use
    // a fresh env_name).
    const cA = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-auth-rehydrate', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const aApplied = applyTarget(cA, {
      kind: 'admin-api',
      base_url: NR_BASE,
      env_name: 'int-auth-rehydrate',
    });
    await persistAppliedTarget(aApplied, { auth_env_var: TOKEN_ENV_VAR });

    // Fresh container — rehydration should see the env var and pick up the token.
    const cB = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-auth-rehydrate', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const result = await rehydrateFromPersistedTarget(cB, {
      ENVIRONMENT_NAME: 'int-auth-rehydrate',
      [TOKEN_ENV_VAR]: TOKEN_VALUE,
    });
    expect(result.rehydrated).toBe(true);
    expect(result.applied?.base_url).toBe(NR_BASE);
    // The container's auth got populated from the env var.
    expect(cB.config.NODE_RED_AUTH_TOKEN).toBe(TOKEN_VALUE);
  });

  it('rehydration warns but does not crash when the referenced env var is unset', async () => {
    const cA = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-auth-missing', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const aApplied = applyTarget(cA, {
      kind: 'admin-api',
      base_url: NR_BASE,
      env_name: 'int-auth-missing',
    });
    await persistAppliedTarget(aApplied, { auth_env_var: 'NEVER_SET_ENV_VAR_NAME' });

    const cB = buildContainer({
      env: { ENVIRONMENT_NAME: 'int-auth-missing', LOG_LEVEL: 'silent' },
      serverVersion: '0.6.0-int',
    });
    const result = await rehydrateFromPersistedTarget(cB, {
      ENVIRONMENT_NAME: 'int-auth-missing',
      // NEVER_SET_ENV_VAR_NAME deliberately not in env
    });
    // Rehydration still applies the target — just without auth.
    expect(result.rehydrated).toBe(true);
    expect(cB.config.NODE_RED_AUTH_TOKEN).toBeUndefined();
  });
});
