import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StagedStore } from '../../../../src/toolkit/staging/staged-store.js';

let dir: string;
let store: StagedStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'staged-'));
  store = new StagedStore({ dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('StagedStore', () => {
  it('writes and reads a staged change', async () => {
    const change = {
      flows: [{ id: 'tab', type: 'tab' as const, label: 'T' }],
      basedOnSnapshotHash: 'h1',
      basedOnRev: null,
      stagedHash: 'h2',
      stagedAt: '2026-05-01T00:00:00.000Z',
      actor: 'a',
      reason: 'r',
    };
    await store.write(change);
    const back = await store.read();
    expect(back).toMatchObject({ stagedHash: 'h2', basedOnSnapshotHash: 'h1' });
  });

  it('returns null when nothing staged', async () => {
    expect(await store.read()).toBeNull();
  });

  it('clear removes the staged file', async () => {
    await store.write({
      flows: [{ id: 'tab', type: 'tab' as const, label: 'T' }],
      basedOnSnapshotHash: 'h1',
      basedOnRev: null,
      stagedHash: 'h2',
      stagedAt: '2026-05-01T00:00:00.000Z',
      actor: 'a',
      reason: 'r',
    });
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});
