import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { setLinksTool } from '../../../../../src/server/tools/author/set-links.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const FIXTURE_FLOWS = [
  { id: 'tab-1', type: 'tab', label: 'A', _authoringKey: 'tab-1' },
  { id: 'tab-2', type: 'tab', label: 'B', _authoringKey: 'tab-2' },
  {
    id: 'id-lout',
    type: 'link out',
    z: 'tab-1',
    x: 100,
    y: 100,
    wires: [],
    name: 'Out',
    _authoringKey: 'lout',
  },
  {
    id: 'id-lcall',
    type: 'link call',
    z: 'tab-1',
    x: 200,
    y: 100,
    wires: [[]],
    name: 'Call',
    links: ['id-lin'],
    _authoringKey: 'lcall',
  },
  {
    id: 'id-lin',
    type: 'link in',
    z: 'tab-2',
    x: 100,
    y: 100,
    wires: [[]],
    name: 'In',
    _authoringKey: 'lin',
  },
  {
    id: 'id-inj',
    type: 'inject',
    z: 'tab-2',
    x: 300,
    y: 100,
    wires: [[]],
    name: 'Inj',
    _authoringKey: 'inj',
  },
];

let ctx: ToolContext;
let cleanup: () => Promise<void>;

interface SetLinksOutput {
  ok: boolean;
  paired_count: number;
  staged_hash: string;
  diff_summary: { nodes_modified: number };
}

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'set-links-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(FIXTURE_FLOWS), 'utf8');

  const merged = {
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    RENDER_DIR: path.join(root, 'renders'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
  };
  const config = loadConfig(merged);
  const logger = createLogger({ level: 'silent' });
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
  };
  ctx = {
    ...containerFields,
    enrichAudit: () => undefined,
    container: containerFields,
  };
  cleanup = async (): Promise<void> => {
    await rm(root, { recursive: true, force: true });
  };
});

afterEach(async () => {
  await cleanup();
});

describe('set_links tool', () => {
  it('pairs link out → link in', async () => {
    const out = (await setLinksTool.handler(
      { source_node_id: 'id-lout', target_node_ids: ['id-lin'] },
      ctx,
    )) as SetLinksOutput;
    expect(out.ok).toBe(true);
    expect(out.paired_count).toBe(1);
    expect(out.diff_summary.nodes_modified).toBeGreaterThanOrEqual(1);
  });

  it('pairs link call → link in', async () => {
    const out = (await setLinksTool.handler(
      { source_node_id: 'id-lcall', target_node_ids: ['id-lin'] },
      ctx,
    )) as SetLinksOutput;
    expect(out.paired_count).toBe(1);
  });

  it('rejects unknown source id', async () => {
    await expect(
      setLinksTool.handler({ source_node_id: 'nope', target_node_ids: ['id-lin'] }, ctx),
    ).rejects.toThrow(/'nope' not found/);
  });

  it('rejects unknown target id', async () => {
    await expect(
      setLinksTool.handler({ source_node_id: 'id-lout', target_node_ids: ['nope'] }, ctx),
    ).rejects.toThrow(/'nope' not found/);
  });

  it('rejects source that is not a link out / link call', async () => {
    await expect(
      setLinksTool.handler({ source_node_id: 'id-inj', target_node_ids: ['id-lin'] }, ctx),
    ).rejects.toThrow(/expected 'link out' or 'link call'/);
  });

  it('rejects target that is not a link in', async () => {
    await expect(
      setLinksTool.handler({ source_node_id: 'id-lout', target_node_ids: ['id-inj'] }, ctx),
    ).rejects.toThrow(/expected 'link in'/);
  });

  it('allows clearing with empty target list', async () => {
    const out = (await setLinksTool.handler(
      { source_node_id: 'id-lout', target_node_ids: [] },
      ctx,
    )) as SetLinksOutput;
    expect(out.paired_count).toBe(0);
  });
});
