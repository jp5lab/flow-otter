import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { addConfigNodeTool } from '../../../../../src/server/tools/author/add-config-node.js';
import { addConfigNode } from '../../../../../src/toolkit/authoring/operations/add-config-node.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';
import { createLogger } from '../../../../../src/shared/logger.js';

const BASE_FLOWS = [
  { id: 'tab1', type: 'tab', label: 'Main', _authoringKey: 'tab1' },
  {
    id: 'source1',
    type: 'inject',
    z: 'tab1',
    x: 100,
    y: 100,
    wires: [[]],
    name: 'Source',
    _authoringKey: 'source',
  },
];

const EMPTY_SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tab1',
      label: 'Main',
      nodes: [],
      connections: [],
      groups: [],
      comments: [],
    },
  ],
};

let ctx: ToolContext;
let cleanup: () => Promise<void>;

async function buildCtx(fixture: unknown[] = BASE_FLOWS): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'add-config-node-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(fixture), 'utf8');

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
    ENABLE_WRITE_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
  });
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
  ctx = { ...containerFields, enrichAudit: () => undefined, container: containerFields };
  cleanup = async () => rm(root, { recursive: true, force: true });
}

beforeEach(async () => {
  await buildCtx();
});

afterEach(async () => {
  await cleanup();
});

describe('add_config_node operation', () => {
  it('throws on duplicate config-node keys', () => {
    const spec = addConfigNode(EMPTY_SPEC, { key: 'broker', type: 'mqtt-broker' }).spec;

    expect(() => addConfigNode(spec, { key: 'broker', type: 'mqtt-broker' })).toThrow(
      /Config node key 'broker' already exists/,
    );
  });
});

describe('add_config_node tool', () => {
  it('has strict input schema validation', () => {
    expect(() =>
      addConfigNodeTool.inputZod.parse({
        key: 'broker',
        type: 'mqtt-broker',
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      addConfigNodeTool.inputZod.parse({
        key: 'broker',
        type: 'mqtt-broker',
        label: 'this label is far too long',
      }),
    ).toThrow();
  });

  it('rejects credentials in mqtt-broker passthrough without staging', async () => {
    await expect(
      addConfigNodeTool.handler(
        {
          key: 'broker',
          type: 'mqtt-broker',
          passthrough: { credentials: { password: 'secret' } },
        },
        ctx,
      ),
    ).rejects.toThrow(/credentials.*not authored/i);

    expect(await ctx.staging.read()).toBeNull();
  });

  it('rejects credentials in tls-config passthrough without staging', async () => {
    await expect(
      addConfigNodeTool.handler(
        {
          key: 'tls-main',
          type: 'tls-config',
          passthrough: { credentials: { passphrase: 'secret' } },
        },
        ctx,
      ),
    ).rejects.toThrow(/credentials.*not authored/i);

    expect(await ctx.staging.read()).toBeNull();
  });

  it('validates passthrough against NODE_SCHEMAS when the type is registered', async () => {
    await expect(
      addConfigNodeTool.handler(
        {
          key: 'shape-config',
          type: 'change',
          passthrough: { rules: 'not-an-array' },
        },
        ctx,
      ),
    ).rejects.toThrow(/passthrough for type 'change' failed schema validation/);

    expect(await ctx.staging.read()).toBeNull();
  });

  it('validates tls-config passthrough against its registered schema', async () => {
    const out = (await addConfigNodeTool.handler(
      {
        key: 'tls-main',
        type: 'tls-config',
        label: 'TLS Main',
        passthrough: {
          certType: 'pfx',
          p12: '/certs/client.p12',
          p12name: 'client.p12',
          servername: 'api.example.test',
          verifyservercert: false,
          alpnprotocol: 'h2',
        },
      },
      ctx,
    )) as {
      ok: boolean;
      added_config_node_id?: string;
      type_had_schema: boolean;
      diff_summary: { nodes_added: number };
    };

    expect(out.ok).toBe(true);
    expect(out.type_had_schema).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);

    const staged = await ctx.staging.read();
    const configNode = staged?.flows.find((n) => n.id === out.added_config_node_id) as
      | Record<string, unknown>
      | undefined;
    expect(configNode).toMatchObject({
      type: 'tls-config',
      name: 'TLS Main',
      certType: 'pfx',
      p12: '/certs/client.p12',
      p12name: 'client.p12',
      servername: 'api.example.test',
      verifyservercert: false,
      alpnprotocol: 'h2',
      _authoringKey: 'tls-main',
    });
  });

  it('stages a config node and emits no canvas fields', async () => {
    const out = (await addConfigNodeTool.handler(
      {
        key: 'broker-main',
        type: 'mqtt-broker',
        label: 'Broker',
        passthrough: {
          broker: 'localhost',
          port: '1883',
          protocolVersion: 5,
          willTopic: 'status/offline',
          willQos: '1',
          willRetain: 'true',
          willPayload: 'offline',
          willMsg: { payloadType: 'str' },
        },
      },
      ctx,
    )) as {
      ok: boolean;
      added_config_node_id?: string;
      type_had_schema: boolean;
      diff_summary: { nodes_added: number };
    };

    expect(out.ok).toBe(true);
    expect(out.added_config_node_id).toMatch(/^[0-9a-f]{16}$/);
    expect(out.type_had_schema).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);

    const staged = await ctx.staging.read();
    const configNode = staged?.flows.find((n) => n.id === out.added_config_node_id) as
      | Record<string, unknown>
      | undefined;
    expect(configNode).toMatchObject({
      type: 'mqtt-broker',
      name: 'Broker',
      broker: 'localhost',
      protocolVersion: 5,
      willTopic: 'status/offline',
      willQos: '1',
      willRetain: 'true',
      willPayload: 'offline',
      willMsg: { payloadType: 'str' },
      _authoringKey: 'broker-main',
    });
    for (const field of ['x', 'y', 'z', 'wires'] as const) {
      expect(configNode?.[field], `config node must not carry ${field}`).toBeUndefined();
    }
  });
});
