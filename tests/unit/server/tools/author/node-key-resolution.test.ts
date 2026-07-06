import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { Container } from '../../../../../src/server/container.js';
import { makeInvokable, type ToolContext } from '../../../../../src/server/tools/_tool.js';
import { moveNodeTool } from '../../../../../src/server/tools/author/move-node.js';
import { wireNodesTool } from '../../../../../src/server/tools/author/wire-nodes.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import type { FlowsJson } from '../../../../../src/shared/flows-json.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';

const TAB_MAIN_ID = '1111111111111111';
const TAB_OTHER_ID = '2222222222222222';
const SOURCE_ID = 'aaaaaaaaaaaaaaaa';
const TARGET_ID = 'bbbbbbbbbbbbbbbb';
const OTHER_ID = 'cccccccccccccccc';
const MISSING_ID = 'dddddddddddddddd';

const BASE_FLOWS: FlowsJson = [
  { id: TAB_MAIN_ID, type: 'tab', label: 'Main', _authoringKey: 'tab-main' },
  { id: TAB_OTHER_ID, type: 'tab', label: 'Other', _authoringKey: 'tab-other' },
  {
    id: SOURCE_ID,
    type: 'inject',
    z: TAB_MAIN_ID,
    x: 100,
    y: 100,
    name: 'Source',
    wires: [[]],
    _authoringKey: 'source',
  },
  {
    id: TARGET_ID,
    type: 'debug',
    z: TAB_MAIN_ID,
    x: 280,
    y: 100,
    name: 'Target',
    wires: [],
    _authoringKey: 'target',
  },
  {
    id: OTHER_ID,
    type: 'debug',
    z: TAB_OTHER_ID,
    x: 100,
    y: 100,
    name: 'Other Target',
    wires: [],
    _authoringKey: 'other-target',
  },
];

interface BuiltContext {
  readonly ctx: ToolContext;
  readonly container: Container;
  readonly staging: StagedStore;
  readonly cleanup: () => Promise<void>;
}

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function buildCtx(flows: FlowsJson = BASE_FLOWS): Promise<BuiltContext> {
  const root = await mkdtemp(path.join(tmpdir(), 'node-key-resolution-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(flows), 'utf8');
  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    RENDER_DIR: path.join(root, 'renders'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
  });
  const logger = createLogger({ level: 'silent' });
  const staging = new StagedStore({ dir: config.STAGING_DIR });
  const container: Container = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging,
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: (): Date => new Date('2026-05-01T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  return {
    ctx: { ...container, enrichAudit: () => undefined, container },
    container,
    staging,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

describe('author node-key resolution from Node-RED ids', () => {
  it('move_node resolves a same-tab Node-RED id to its authoring key', async () => {
    const built = await buildCtx();
    cleanup = built.cleanup;

    const out = (await moveNodeTool.handler(
      { tab_id: TAB_MAIN_ID, node_key: TARGET_ID, position: { x: 360, y: 180 } },
      built.ctx,
    )) as { ok: boolean; moved_node_key: string };

    expect(out.ok).toBe(true);
    expect(out.moved_node_key).toBe('target');
    const staged = await built.staging.read();
    const moved = staged?.flows.find((n) => n.id === TARGET_ID) as { x?: number; y?: number };
    expect(moved).toMatchObject({ x: 360, y: 180 });
  });

  it('wire_nodes resolves same-tab Node-RED ids through the shared helper', async () => {
    const built = await buildCtx();
    cleanup = built.cleanup;

    const out = (await wireNodesTool.handler(
      { tab_id: TAB_MAIN_ID, from_key: SOURCE_ID, to_key: TARGET_ID },
      built.ctx,
    )) as { ok: boolean; wire_added: boolean };

    expect(out.ok).toBe(true);
    expect(out.wire_added).toBe(true);
    const staged = await built.staging.read();
    const source = staged?.flows.find((n) => n.id === SOURCE_ID) as { wires?: string[][] };
    expect(source.wires).toEqual([[TARGET_ID]]);
  });

  it('key matches beat id matches when the same value could mean both', async () => {
    const built = await buildCtx([
      { id: TAB_MAIN_ID, type: 'tab', label: 'Main', _authoringKey: 'tab-main' },
      {
        id: SOURCE_ID,
        type: 'inject',
        z: TAB_MAIN_ID,
        x: 100,
        y: 100,
        wires: [[]],
        _authoringKey: TARGET_ID,
      },
      {
        id: TARGET_ID,
        type: 'debug',
        z: TAB_MAIN_ID,
        x: 280,
        y: 100,
        wires: [],
        _authoringKey: 'target',
      },
    ]);
    cleanup = built.cleanup;

    await moveNodeTool.handler(
      { tab_id: TAB_MAIN_ID, node_key: TARGET_ID, position: { x: 360, y: 180 } },
      built.ctx,
    );

    const staged = await built.staging.read();
    const keyMatched = staged?.flows.find((n) => n.id === SOURCE_ID) as { x?: number; y?: number };
    const idMatched = staged?.flows.find((n) => n.id === TARGET_ID) as { x?: number; y?: number };
    expect(keyMatched).toMatchObject({ x: 360, y: 180 });
    expect(idMatched).toMatchObject({ x: 280, y: 100 });
  });

  it('refuses a Node-RED id that belongs to another tab and names that tab', async () => {
    const built = await buildCtx();
    cleanup = built.cleanup;

    await expect(
      moveNodeTool.handler(
        { tab_id: TAB_MAIN_ID, node_key: OTHER_ID, position: { x: 360, y: 180 } },
        built.ctx,
      ),
    ).rejects.toThrow(
      `Node, junction, or comment '${OTHER_ID}' is a Node-RED node id on tab 'tab-other', not tab 'tab-main'.`,
    );
  });

  it('enriches missing hex-id errors with node-key vocabulary guidance', async () => {
    const built = await buildCtx();
    cleanup = built.cleanup;

    await expect(
      moveNodeTool.handler(
        { tab_id: TAB_MAIN_ID, node_key: MISSING_ID, position: { x: 360, y: 180 } },
        built.ctx,
      ),
    ).rejects.toThrow(
      `Node, junction, or comment '${MISSING_ID}' looks like a Node-RED node id, but no node, junction, or comment with that id was found. Author tools take node authoring keys; get_flow shows both id and _authoringKey.`,
    );
  });

  it('emits a soft nudge when an id is accepted as a node key', async () => {
    const built = await buildCtx();
    cleanup = built.cleanup;

    const invokable = makeInvokable(moveNodeTool);
    const out = (await invokable.invoke(
      { tab_id: TAB_MAIN_ID, node_key: TARGET_ID, position: { x: 360, y: 180 } },
      built.container,
    )) as { ok: boolean; _guidance?: string[] };

    expect(out.ok).toBe(true);
    expect(out._guidance?.join('\n')).toContain(
      `Resolved Node-RED node id '${TARGET_ID}' to authoring key 'target'.`,
    );
  });
});
