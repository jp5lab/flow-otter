import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { setWiresTool } from '../../../../../src/server/tools/author/set-wires.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const TAB_ID = 'tab-x';
const FIXTURE_FLOWS = [
  { id: TAB_ID, type: 'tab', label: 'X', _authoringKey: TAB_ID },
  {
    id: 'id-inj',
    type: 'inject',
    z: TAB_ID,
    x: 100,
    y: 100,
    wires: [['id-fn']],
    name: 'Inj',
    _authoringKey: 'inj',
  },
  {
    id: 'id-fn',
    type: 'function',
    z: TAB_ID,
    x: 200,
    y: 100,
    wires: [['id-d1', 'id-d2']],
    name: 'Fn',
    func: 'return msg;',
    outputs: 1,
    _authoringKey: 'fn',
  },
  {
    id: 'id-d1',
    type: 'debug',
    z: TAB_ID,
    x: 300,
    y: 100,
    wires: [],
    name: 'D1',
    _authoringKey: 'd1',
  },
  {
    id: 'id-d2',
    type: 'debug',
    z: TAB_ID,
    x: 300,
    y: 200,
    wires: [],
    name: 'D2',
    _authoringKey: 'd2',
  },
  {
    id: 'id-d3',
    type: 'debug',
    z: TAB_ID,
    x: 300,
    y: 300,
    wires: [],
    name: 'D3',
    _authoringKey: 'd3',
  },
];

interface SetWiresOutput {
  ok: boolean;
  wires_removed_count: number;
  wires_added_count: number;
  diff_summary: { wires_added: number; wires_removed: number };
}

let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'set-wires-'));
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
  cleanup = async () => {
    await rm(root, { recursive: true, force: true });
  };
});

afterEach(async () => {
  await cleanup();
});

describe('set_wires tool', () => {
  it('replaces all wires on (fn, port 0) with a single new target', async () => {
    const out = (await setWiresTool.handler(
      { tab_id: TAB_ID, source_node_id: 'id-fn', target_node_ids: ['id-d3'] },
      ctx,
    )) as SetWiresOutput;
    expect(out.ok).toBe(true);
    expect(out.wires_removed_count).toBe(2);
    expect(out.wires_added_count).toBe(1);
  });

  it('clears wires with empty target list', async () => {
    const out = (await setWiresTool.handler(
      { tab_id: TAB_ID, source_node_id: 'id-fn', target_node_ids: [] },
      ctx,
    )) as SetWiresOutput;
    expect(out.wires_removed_count).toBe(2);
    expect(out.wires_added_count).toBe(0);
  });

  it('rejects unknown source id', async () => {
    await expect(
      setWiresTool.handler(
        { tab_id: TAB_ID, source_node_id: 'nope', target_node_ids: ['id-d1'] },
        ctx,
      ),
    ).rejects.toThrow(/'nope' not found/);
  });

  it('rejects unknown target id', async () => {
    await expect(
      setWiresTool.handler(
        { tab_id: TAB_ID, source_node_id: 'id-fn', target_node_ids: ['nope'] },
        ctx,
      ),
    ).rejects.toThrow(/'nope' not found/);
  });

  it('rejects self-wire', async () => {
    await expect(
      setWiresTool.handler(
        { tab_id: TAB_ID, source_node_id: 'id-fn', target_node_ids: ['id-fn'] },
        ctx,
      ),
    ).rejects.toThrow(/to itself/);
  });

  it('rejects out-of-range output port', async () => {
    await expect(
      setWiresTool.handler(
        {
          tab_id: TAB_ID,
          source_node_id: 'id-inj',
          output_port: 4,
          target_node_ids: ['id-d1'],
        },
        ctx,
      ),
    ).rejects.toThrow(/out of range/);
  });
});
