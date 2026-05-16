import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPersistedTarget,
  persistedTargetAgeSeconds,
  persistedTargetPath,
  readPersistedTarget,
  writePersistedTarget,
} from '../../../../src/server/state/persisted-target.js';

let homeDir: string;
const ENV_NAME = 'unit-scope';

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(os.tmpdir(), 'flow-otter-persisted-target-'));
  process.env.HOME = homeDir;
  // os.homedir() honours HOME on POSIX and USERPROFILE on Windows; tests run on darwin.
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('persistedTargetPath', () => {
  it('returns ~/.flow-otter/<env_name>/target.json', () => {
    const p = persistedTargetPath(ENV_NAME);
    expect(p).toBe(path.join(homeDir, '.flow-otter', ENV_NAME, 'target.json'));
  });
});

describe('readPersistedTarget', () => {
  it('returns null + no warnings when the file is missing', async () => {
    const result = await readPersistedTarget(ENV_NAME);
    expect(result.target).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('round-trips an admin-api target', async () => {
    const written = await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'admin-api', base_url: 'http://192.0.2.10:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    expect(written).toEqual({
      schema_version: 1,
      env_name: ENV_NAME,
      flow_source: 'admin-api',
      base_url: 'http://192.0.2.10:1880',
      set_at: '2026-05-10T00:00:00.000Z',
    });
    const read = await readPersistedTarget(ENV_NAME);
    expect(read.target).toEqual(written);
    expect(read.warnings).toEqual([]);
  });

  it('round-trips a file target', async () => {
    const written = await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'file', file_path: '/tmp/foo/flows.json' },
      { setAt: '2026-05-10T01:00:00.000Z' },
    );
    expect(written.flow_source).toBe('file');
    const read = await readPersistedTarget(ENV_NAME);
    expect(read.target).toEqual(written);
  });

  it('returns parse-error warning for malformed JSON', async () => {
    const { mkdir } = await import('node:fs/promises');
    const dir = path.join(homeDir, '.flow-otter', ENV_NAME);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'target.json'), 'not-json{', 'utf8');

    const result = await readPersistedTarget(ENV_NAME);
    expect(result.target).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('parse-error');
  });

  it('returns schema-mismatch when env_name does not match scope', async () => {
    await writePersistedTarget(
      'other-env',
      { flow_source: 'admin-api', base_url: 'http://example:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    // Manually move the file to ENV_NAME's dir to simulate a manual mistake.
    const otherFile = persistedTargetPath('other-env');
    const targetDir = path.join(homeDir, '.flow-otter', ENV_NAME);
    const { mkdir, copyFile } = await import('node:fs/promises');
    await mkdir(targetDir, { recursive: true });
    await copyFile(otherFile, persistedTargetPath(ENV_NAME));

    const result = await readPersistedTarget(ENV_NAME);
    expect(result.target).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('schema-mismatch');
  });

  it('returns schema-mismatch for unknown schema_version', async () => {
    const dir = path.join(homeDir, '.flow-otter', ENV_NAME);
    const file = path.join(dir, 'target.json');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        schema_version: 99,
        env_name: ENV_NAME,
        flow_source: 'admin-api',
        base_url: 'http://example:1880',
        set_at: '2026-05-10T00:00:00.000Z',
      }),
      'utf8',
    );
    const result = await readPersistedTarget(ENV_NAME);
    expect(result.target).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('schema-mismatch');
  });
});

describe('writePersistedTarget', () => {
  it('writes via temp-file + rename leaving no .tmp leftovers on success', async () => {
    await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'admin-api', base_url: 'http://example:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const { readdir } = await import('node:fs/promises');
    const dirContents = await readdir(path.join(homeDir, '.flow-otter', ENV_NAME));
    expect(dirContents.filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('overwrites a prior target.json when called twice', async () => {
    await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'file', file_path: '/tmp/a.json' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'admin-api', base_url: 'http://example:1880' },
      { setAt: '2026-05-10T00:00:01.000Z' },
    );
    const result = await readPersistedTarget(ENV_NAME);
    expect(result.target?.flow_source).toBe('admin-api');
    expect((result.target as { base_url?: string } | null)?.base_url).toBe('http://example:1880');
  });

  it('emits sorted-key, 2-space JSON ending in a newline', async () => {
    await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'admin-api', base_url: 'http://example:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const raw = await readFile(persistedTargetPath(ENV_NAME), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toBe(
      [
        '{',
        '  "base_url": "http://example:1880",',
        `  "env_name": "${ENV_NAME}",`,
        '  "flow_source": "admin-api",',
        '  "schema_version": 1,',
        '  "set_at": "2026-05-10T00:00:00.000Z"',
        '}',
        '',
      ].join('\n'),
    );
  });
});

describe('clearPersistedTarget', () => {
  it('returns true when removing an existing target.json', async () => {
    await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'admin-api', base_url: 'http://example:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const removed = await clearPersistedTarget(ENV_NAME);
    expect(removed).toBe(true);
    const after = await readPersistedTarget(ENV_NAME);
    expect(after.target).toBeNull();
  });

  it('returns false when the file is already absent', async () => {
    const removed = await clearPersistedTarget(ENV_NAME);
    expect(removed).toBe(false);
  });
});

describe('persistedTargetAgeSeconds', () => {
  it('returns null when no file exists', async () => {
    expect(await persistedTargetAgeSeconds(ENV_NAME)).toBeNull();
  });

  it('returns a non-negative number when a file exists', async () => {
    await writePersistedTarget(
      ENV_NAME,
      { flow_source: 'admin-api', base_url: 'http://example:1880' },
      { setAt: '2026-05-10T00:00:00.000Z' },
    );
    const age = await persistedTargetAgeSeconds(ENV_NAME);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(0);
  });
});
