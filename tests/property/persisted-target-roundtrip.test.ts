import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import {
  readPersistedTarget,
  writePersistedTarget,
} from '../../src/server/state/persisted-target.js';

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(os.tmpdir(), 'persisted-target-prop-'));
  process.env.HOME = homeDir;
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

const arbEnvName = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s));

const arbBaseUrl = fc
  .tuple(
    fc.constantFrom('http', 'https'),
    fc.tuple(
      fc.integer({ min: 1, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 255 }),
    ),
    fc.integer({ min: 1, max: 65535 }),
  )
  .map(([scheme, octets, port]) => `${scheme}://${octets.join('.')}:${port}`);

const arbFilePath = fc
  .array(
    fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => `/${parts.join('/')}/flows.json`);

const arbSetAt = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

const arbAdminApi = fc.record({
  envName: arbEnvName,
  baseUrl: arbBaseUrl,
  setAt: arbSetAt,
});

const arbFile = fc.record({
  envName: arbEnvName,
  filePath: arbFilePath,
  setAt: arbSetAt,
});

describe('persisted target round-trip', () => {
  it('admin-api: write → read returns the same logical record', async () => {
    await fc.assert(
      fc.asyncProperty(arbAdminApi, async ({ envName, baseUrl, setAt }) => {
        const written = await writePersistedTarget(
          envName,
          { flow_source: 'admin-api', base_url: baseUrl },
          { setAt },
        );
        const { target } = await readPersistedTarget(envName);
        expect(target).toEqual(written);
      }),
      { numRuns: 200 },
    );
  });

  it('file: write → read returns the same logical record', async () => {
    await fc.assert(
      fc.asyncProperty(arbFile, async ({ envName, filePath, setAt }) => {
        const written = await writePersistedTarget(
          envName,
          { flow_source: 'file', file_path: filePath },
          { setAt },
        );
        const { target } = await readPersistedTarget(envName);
        expect(target).toEqual(written);
      }),
      { numRuns: 200 },
    );
  });

  it('write is byte-stable: same input → identical bytes on disk', async () => {
    await fc.assert(
      fc.asyncProperty(arbAdminApi, async ({ envName, baseUrl, setAt }) => {
        await writePersistedTarget(
          envName,
          { flow_source: 'admin-api', base_url: baseUrl },
          { setAt },
        );
        const first = await readFile(
          path.join(homeDir, '.flow-otter', envName, 'target.json'),
          'utf8',
        );
        await writePersistedTarget(
          envName,
          { flow_source: 'admin-api', base_url: baseUrl },
          { setAt },
        );
        const second = await readFile(
          path.join(homeDir, '.flow-otter', envName, 'target.json'),
          'utf8',
        );
        expect(second).toBe(first);
      }),
      { numRuns: 200 },
    );
  });
});
