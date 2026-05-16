import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FilesystemSnapshotStore } from '../../../../src/toolkit/snapshot/filesystem.js';

let dir: string;
let store: FilesystemSnapshotStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'snapstore-'));
  store = new FilesystemSnapshotStore({ rootDir: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const flows = [
  { id: 'tab', type: 'tab', label: 'X' },
  { id: 'aaaaaaaaaaaaaaaa', type: 'inject', z: 'tab', x: 0, y: 0, wires: [] },
];

describe('FilesystemSnapshotStore', () => {
  it('saves and loads a snapshot', async () => {
    const ref = await store.save({
      flows: flows,
      rev: 'r1',
      env: 'test',
      actor: 'a',
      reason: 'r',
      takenAt: '2026-05-01T00:00:00.000Z',
    });
    const payload = await store.load(ref);
    expect(payload.flows).toEqual(flows);
    expect(payload.manifest.sha256).toBe(ref.sha256);
  });

  it('latest returns the most-recent snapshot', async () => {
    const a = await store.save({
      flows: flows,
      rev: null,
      env: 'test',
      actor: 'a',
      reason: 'first',
      takenAt: '2026-05-01T00:00:00.000Z',
    });
    const b = await store.save({
      flows: [...flows, { id: 'extra', type: 'debug', z: 'tab', x: 0, y: 0, wires: [] }] as never,
      rev: null,
      env: 'test',
      actor: 'a',
      reason: 'second',
      takenAt: '2026-05-01T00:01:00.000Z',
    });
    const latest = await store.latest('test');
    expect(latest?.id).toBe(b.id);
    expect(a.id).not.toBe(b.id);
  });

  it('prune keeps only the last N', async () => {
    for (let i = 0; i < 5; i++) {
      const ts = `2026-05-01T00:0${i}:00.000Z`;
      await store.save({
        flows: [
          ...flows,
          { id: `n${i}`.padEnd(16, 'a'), type: 'debug', z: 'tab', x: 0, y: 0, wires: [] },
        ] as never,
        rev: null,
        env: 'test',
        actor: 'a',
        reason: `r${i}`,
        takenAt: ts,
      });
    }
    const { removed } = await store.prune({ env: 'test', keepLast: 2 });
    expect(removed.length).toBe(3);
    const remaining = await store.list({ env: 'test' });
    expect(remaining).toHaveLength(2);
  });

  it('prune respects protectTags', async () => {
    await store.save({
      flows: flows,
      rev: null,
      env: 'test',
      actor: 'a',
      reason: 'pinned',
      takenAt: '2026-05-01T00:00:00.000Z',
      tags: ['pinned'],
    });
    await store.save({
      flows: [
        ...flows,
        { id: 'extranode000000a', type: 'debug', z: 'tab', x: 0, y: 0, wires: [] },
      ] as never,
      rev: null,
      env: 'test',
      actor: 'a',
      reason: 'extra',
      takenAt: '2026-05-01T00:01:00.000Z',
    });
    const { removed } = await store.prune({ env: 'test', keepLast: 1, protectTags: ['pinned'] });
    // pinned is older but protected; only the unpinned one would be eligible — but keepLast=1 keeps the newest, so pinned would be removed except it's protected.
    expect(removed.find((r) => r.tags.includes('pinned'))).toBeUndefined();
  });

  it('auto-prunes per env when retentionKeepLast is set', async () => {
    const cap = new FilesystemSnapshotStore({ rootDir: dir, retentionKeepLast: 2 });
    for (let i = 0; i < 5; i++) {
      const ts = `2026-05-02T00:0${i}:00.000Z`;
      await cap.save({
        flows: [
          ...flows,
          { id: `cap${i}`.padEnd(16, 'a'), type: 'debug', z: 'tab', x: 0, y: 0, wires: [] },
        ] as never,
        rev: null,
        env: 'capped',
        actor: 'a',
        reason: `r${i}`,
        takenAt: ts,
      });
    }
    const remaining = await cap.list({ env: 'capped' });
    expect(remaining).toHaveLength(2);
  });

  it('auto-prune respects retentionProtectTags', async () => {
    const cap = new FilesystemSnapshotStore({
      rootDir: dir,
      retentionKeepLast: 1,
      retentionProtectTags: ['pre-dangerous'],
    });
    await cap.save({
      flows: flows,
      rev: null,
      env: 'safe',
      actor: 'a',
      reason: 'preserve',
      takenAt: '2026-05-03T00:00:00.000Z',
      tags: ['pre-dangerous'],
    });
    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-03T01:0${i}:00.000Z`;
      await cap.save({
        flows: [
          ...flows,
          { id: `sf${i}`.padEnd(16, 'a'), type: 'debug', z: 'tab', x: 0, y: 0, wires: [] },
        ] as never,
        rev: null,
        env: 'safe',
        actor: 'a',
        reason: `r${i}`,
        takenAt: ts,
      });
    }
    const remaining = await cap.list({ env: 'safe' });
    expect(remaining.some((r) => r.tags.includes('pre-dangerous'))).toBe(true);
  });
});
