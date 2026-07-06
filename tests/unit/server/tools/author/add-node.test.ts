import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { Container } from '../../../../../src/server/container.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { addNodeTool } from '../../../../../src/server/tools/author/add-node.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

let root: string;
let container: Container;
let ctx: ToolContext;
const TAB_ID = 'tab-1';

const SEED_FLOWS = JSON.stringify([
  { id: TAB_ID, type: 'tab', label: 'Test', disabled: false, info: '' },
  {
    id: 'inj-1',
    type: 'inject',
    z: TAB_ID,
    name: 'src',
    props: [{ p: 'payload', v: '1', vt: 'num' }],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '1',
    payloadType: 'num',
    x: 100,
    y: 80,
    wires: [[]],
  },
]);

type AddNodeResult = {
  ok: boolean;
  type_had_schema: boolean;
  added_node_id?: string;
  defaults_applied_from: Record<string, 'schema' | 'settings'>;
};

function attachRuntime(
  version: string,
  nodeDefaults: Record<string, Record<string, unknown>>,
): void {
  const fakeClient = {
    getNoderedVersion: () => Promise.resolve({ version, nodeDefaults }),
  } as unknown as NonNullable<Container['noderedClient']>;
  container.noderedClient = fakeClient;
  ctx = { ...ctx, noderedClient: fakeClient, container };
}

async function stagedNode(
  nodeId: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  const staged = await ctx.staging.read();
  return staged?.flows.find((n) => n.id === nodeId);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'add-node-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, SEED_FLOWS, 'utf8');
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
    REQUEST_TIMEOUT_MS: '100',
    ENABLE_WRITE_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
  });
  const logger = createLogger({ level: 'silent' });
  container = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging: new StagedStore({ dir: config.STAGING_DIR }),
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: () => new Date('2026-05-10T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  ctx = { ...container, enrichAudit: () => undefined, container };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('add_node tool', () => {
  it('stages a change node with validated rules passthrough', async () => {
    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'change',
        opts: {
          label: 'shape',
          passthrough: {
            rules: [{ t: 'set', p: 'topic', to: 'foo/bar', tot: 'str' }],
          },
          source_node_id: 'inj-1',
        },
      },
      ctx,
    )) as { ok: boolean; type_had_schema: boolean; added_node_id?: string; added_wire?: unknown };
    expect(result.ok).toBe(true);
    expect(result.type_had_schema).toBe(true);
    expect(result.added_node_id).toBeDefined();
    expect(result.added_wire).toBeDefined();
  });

  it('rejects malformed change passthrough', async () => {
    await expect(
      addNodeTool.handler(
        {
          tab_id: TAB_ID,
          type: 'change',
          opts: {
            passthrough: {
              // rules must be an array per schema
              rules: 'not-an-array',
            },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/passthrough for type 'change' failed schema validation/);
  });

  it('accepts arbitrary passthrough for unknown types with type_had_schema=false', async () => {
    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'some-contrib-node',
        opts: {
          label: 'custom',
          passthrough: { foo: 'bar', count: 42 },
        },
      },
      ctx,
    )) as { ok: boolean; type_had_schema: boolean };
    expect(result.ok).toBe(true);
    expect(result.type_had_schema).toBe(false);
  });

  it('stages an http in node with validated passthrough', async () => {
    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'http in',
        opts: {
          label: 'webhook',
          passthrough: { url: '/hook', method: 'post' },
        },
      },
      ctx,
    )) as { ok: boolean; type_had_schema: boolean };
    expect(result.ok).toBe(true);
    expect(result.type_had_schema).toBe(true);
  });

  it('stages node info as a top-level Node-RED field', async () => {
    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'function',
        opts: {
          label: 'worker',
          info: 'Documents the worker stage.',
          passthrough: { func: 'return msg;', outputs: 1 },
        },
      },
      ctx,
    )) as { ok: boolean; added_node_id?: string };
    expect(result.ok).toBe(true);
    const staged = await ctx.staging.read();
    const node = staged?.flows.find((n) => n.id === result.added_node_id) as
      | Record<string, unknown>
      | undefined;
    expect(node?.['info']).toBe('Documents the worker stage.');
  });

  it('places at next free slot when no source_node and no position', async () => {
    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'switch',
        opts: {
          label: 'route',
          passthrough: {
            property: 'payload',
            propertyType: 'msg',
            rules: [{ t: 'eq', v: '1', vt: 'num' }],
          },
        },
      },
      ctx,
    )) as { ok: boolean; added_wire?: unknown };
    expect(result.ok).toBe(true);
    expect(result.added_wire).toBeUndefined();
  });

  it('materializes runtime-required defaults when passthrough is omitted (inject)', async () => {
    const result = (await addNodeTool.handler(
      { tab_id: TAB_ID, type: 'inject', opts: { label: 'tick' } },
      ctx,
    )) as AddNodeResult;
    expect(result.ok).toBe(true);
    expect(result.type_had_schema).toBe(true);
    const node = await stagedNode(result.added_node_id);
    // inject is non-functional without `repeat`; the default must materialize it.
    expect(node?.['repeat']).toBe('');
    expect(node?.['payloadType']).toBe('date');
    expect(result.defaults_applied_from['repeat']).toBe('schema');
    expect(result.defaults_applied_from['payloadType']).toBe('schema');
  });

  it('merges add_node defaults as schema < settings < caller passthrough', async () => {
    attachRuntime('4.1.10', {
      inject: { repeat: '30', once: true, payload: 'settings-payload' },
    });

    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'inject',
        opts: {
          label: 'tick',
          passthrough: { payload: 'caller-payload' },
        },
      },
      ctx,
    )) as AddNodeResult;

    const node = await stagedNode(result.added_node_id);
    expect(node?.['repeat']).toBe('30');
    expect(node?.['once']).toBe(true);
    expect(node?.['payload']).toBe('caller-payload');
    expect(node?.['payloadType']).toBe('date');
    expect(result.defaults_applied_from['repeat']).toBe('settings');
    expect(result.defaults_applied_from['once']).toBe('settings');
    expect(result.defaults_applied_from['payload']).toBeUndefined();
    expect(result.defaults_applied_from['payloadType']).toBe('schema');
  });

  it('does not apply settings nodeDefaults without the runtime capability', async () => {
    attachRuntime('4.1.8', {
      inject: { repeat: '30' },
    });

    const result = (await addNodeTool.handler(
      { tab_id: TAB_ID, type: 'inject', opts: { label: 'tick' } },
      ctx,
    )) as AddNodeResult;

    const node = await stagedNode(result.added_node_id);
    expect(node?.['repeat']).toBe('');
    expect(result.defaults_applied_from['repeat']).toBe('schema');
  });

  it('does not apply settings nodeDefaults when settings lack the node type', async () => {
    attachRuntime('4.1.10', {
      debug: { active: false },
    });

    const result = (await addNodeTool.handler(
      { tab_id: TAB_ID, type: 'inject', opts: { label: 'tick' } },
      ctx,
    )) as AddNodeResult;

    const node = await stagedNode(result.added_node_id);
    expect(node?.['repeat']).toBe('');
    expect(result.defaults_applied_from['repeat']).toBe('schema');
  });

  it('keeps file-mode behavior to schema defaults only', async () => {
    expect(container.noderedClient).toBeUndefined();

    const result = (await addNodeTool.handler(
      { tab_id: TAB_ID, type: 'inject', opts: { label: 'tick' } },
      ctx,
    )) as AddNodeResult;

    const node = await stagedNode(result.added_node_id);
    expect(node?.['repeat']).toBe('');
    expect(result.defaults_applied_from['repeat']).toBe('schema');
  });

  it('re-validates merged settings defaults before staging', async () => {
    attachRuntime('4.1.10', {
      inject: { once: 'not-a-boolean' },
    });

    await expect(
      addNodeTool.handler({ tab_id: TAB_ID, type: 'inject', opts: { label: 'tick' } }, ctx),
    ).rejects.toThrow(/passthrough for type 'inject' failed schema validation/);
  });

  it('stages mqtt-broker as a config node without canvas fields', async () => {
    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'mqtt-broker',
        opts: {
          key: 'broker-main',
          label: 'Broker',
          passthrough: { broker: 'localhost', port: '1883' },
        },
      },
      ctx,
    )) as { ok: boolean; added_node_id?: string };
    expect(result.ok).toBe(true);
    expect(result.added_node_id).toBeDefined();

    const staged = await ctx.staging.read();
    const node = staged?.flows.find((n) => n.id === result.added_node_id) as
      | Record<string, unknown>
      | undefined;
    expect(node?.['type']).toBe('mqtt-broker');
    expect(node?.['broker']).toBe('localhost');
    for (const field of ['x', 'y', 'z', 'wires'] as const) {
      expect(node?.[field], `mqtt-broker must not carry ${field}`).toBeUndefined();
    }
  });

  it('rejects credentials passthrough for legacy config-node adds', async () => {
    await expect(
      addNodeTool.handler(
        {
          tab_id: TAB_ID,
          type: 'mqtt-broker',
          opts: {
            key: 'broker-secret',
            passthrough: { credentials: { password: 'secret' } },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/credentials.*not authored/i);

    expect(await ctx.staging.read()).toBeNull();
  });

  it('does NOT throw when passthrough is omitted for a schema with required fields (change)', async () => {
    // change.rules is required with no default → safeParse({}) fails, so no
    // defaults materialize, but omitting passthrough must NEVER error.
    const result = (await addNodeTool.handler(
      { tab_id: TAB_ID, type: 'change', opts: { label: 'shape' } },
      ctx,
    )) as { ok: boolean; type_had_schema: boolean; added_node_id?: string };
    expect(result.ok).toBe(true);
    expect(result.type_had_schema).toBe(true);
    const staged = await ctx.staging.read();
    const node = staged?.flows.find((n) => n.id === result.added_node_id) as
      | Record<string, unknown>
      | undefined;
    // No bogus `rules` invented.
    expect(node?.['rules']).toBeUndefined();
  });

  it('stages a delay node with Node-RED 5.0 burst mode', async () => {
    const result = (await addNodeTool.handler(
      {
        tab_id: TAB_ID,
        type: 'delay',
        opts: {
          label: 'burst',
          passthrough: { pauseType: 'burst', rate: 10, nbRateUnits: 1, rateUnits: 'second' },
        },
      },
      ctx,
    )) as { ok: boolean; type_had_schema: boolean; added_node_id?: string };
    expect(result.ok).toBe(true);
    expect(result.type_had_schema).toBe(true);
    const staged = await ctx.staging.read();
    const node = staged?.flows.find((n) => n.id === result.added_node_id) as
      | Record<string, unknown>
      | undefined;
    expect(node?.['pauseType']).toBe('burst');
  });

  it('is registered as an author-tier tool', () => {
    expect(addNodeTool.tier).toBe('author');
  });
});
