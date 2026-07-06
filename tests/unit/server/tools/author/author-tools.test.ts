import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { addCatchNodeTool } from '../../../../../src/server/tools/author/add-catch-node.js';
import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import { addCompleteNodeTool } from '../../../../../src/server/tools/author/add-complete-node.js';
import { addFunctionNodeTool } from '../../../../../src/server/tools/author/add-function-node.js';
import { addGroupTool } from '../../../../../src/server/tools/author/add-group.js';
import { addInjectNodeTool } from '../../../../../src/server/tools/author/add-inject-node.js';
import { addLinkCallNodeTool } from '../../../../../src/server/tools/author/add-link-call-node.js';
import { addLinkInNodeTool } from '../../../../../src/server/tools/author/add-link-in-node.js';
import { addLinkOutNodeTool } from '../../../../../src/server/tools/author/add-link-out-node.js';
import { addMqttInNodeTool } from '../../../../../src/server/tools/author/add-mqtt-in-node.js';
import { addMqttOutNodeTool } from '../../../../../src/server/tools/author/add-mqtt-out-node.js';
import { addStatusNodeTool } from '../../../../../src/server/tools/author/add-status-node.js';
import { addSubflowInstanceTool } from '../../../../../src/server/tools/author/add-subflow-instance.js';
import { createSubflowDefinitionTool } from '../../../../../src/server/tools/author/create-subflow-definition.js';
import { instantiateTemplateTool } from '../../../../../src/server/tools/author/instantiate-template.js';
import { moveNodeTool } from '../../../../../src/server/tools/author/move-node.js';
import { removeNodeTool } from '../../../../../src/server/tools/author/remove-node.js';
import { removeGroupTool } from '../../../../../src/server/tools/author/remove-group.js';
import { updateNodeTool } from '../../../../../src/server/tools/author/update-node.js';
import { updateCommentTool } from '../../../../../src/server/tools/author/update-comment.js';
import { updateGroupTool } from '../../../../../src/server/tools/author/update-group.js';
import { wireNodesTool } from '../../../../../src/server/tools/author/wire-nodes.js';
import { isComment, isGroup } from '../../../../../src/shared/flows-json.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const FIXTURE_FLOWS = [
  { id: 'tab1', type: 'tab', label: 'Main', _authoringKey: 'tab1' },
  { id: 'tab2', type: 'tab', label: 'Aux', _authoringKey: 'tab2' },
  {
    id: 'subflow1',
    type: 'subflow',
    name: 'Reusable',
    in: [],
    out: [{ x: 40, y: 80, wires: [] }],
    _authoringKey: 'subflow1',
  },
  {
    id: 'source1',
    type: 'inject',
    z: 'tab1',
    x: 80,
    y: 160,
    wires: [[]],
    name: 'Source',
    _authoringKey: 'source',
  },
  {
    id: 'target1',
    type: 'debug',
    z: 'tab1',
    x: 260,
    y: 160,
    wires: [],
    name: 'Target',
    _authoringKey: 'target',
  },
  {
    id: 'linkin1',
    type: 'link in',
    z: 'tab1',
    x: 80,
    y: 80,
    wires: [[]],
    name: 'Link In Target',
    links: [],
    _authoringKey: 'link-in-target',
  },
  {
    id: 'group1',
    type: 'group',
    z: 'tab1',
    name: 'Existing',
    nodes: [],
    x: 40,
    y: 40,
    w: 420,
    h: 220,
    style: {
      stroke: '#a4a4a4',
      'stroke-opacity': '1',
      fill: 'none',
      'fill-opacity': '1',
      label: true,
      'label-position': 'nw',
    },
    _authoringKey: 'existing-group',
  },
  {
    id: 'comment1',
    type: 'comment',
    z: 'tab1',
    x: 120,
    y: 320,
    name: 'Existing note',
    _authoringKey: 'existing-note',
  },
];

interface AddNodeOutput {
  ok: boolean;
  diff_summary: { nodes_added: number };
  added_node_id?: string;
}

interface AddGroupOutput {
  ok: boolean;
  diff_summary: { nodes_added: number };
  added_group_id?: string;
}

interface AddCommentOutput {
  ok: boolean;
  diff_summary: { nodes_added: number };
  added_comment_id?: string;
}

interface UpdateGroupOutput {
  ok: boolean;
  diff_summary: { nodes_modified: number };
  updated: boolean;
}

interface RemoveGroupOutput {
  ok: boolean;
  diff_summary: { nodes_removed: number };
  removed: boolean;
}

interface UpdateCommentOutput {
  ok: boolean;
  diff_summary: { nodes_modified: number };
  updated: boolean;
}

interface WireNodesOutput {
  ok: boolean;
  diff_summary: { wires_added: number };
  wire_added: boolean;
}

interface RemoveNodeOutput {
  ok: boolean;
  diff_summary: { nodes_removed: number };
  removed: boolean;
}

interface UpdateNodeOutput {
  ok: boolean;
  diff_summary: { nodes_modified: number };
  updated: boolean;
}

interface MoveNodeOutput {
  ok: boolean;
  moved_node_key: string;
  source_tab_id: string;
  dest_tab_id: string;
}

interface CreateSubflowDefinitionOutput {
  ok: boolean;
  diff_summary: { nodes_added: number };
  new_def_id?: string;
}

interface InstantiateTemplateOutput {
  ok: boolean;
  template_name: string;
  diff_summary: { nodes_added: number };
  staged_hash: string;
}

let ctx: ToolContext;
let cleanup: () => Promise<void>;

async function rebuildCtx(
  fixture: unknown[],
): Promise<{ ctx: ToolContext; cleanup: () => Promise<void>; reset: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'auth-tools-alt-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(fixture), 'utf8');
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
  const flowSource = new FileFlowSource({ path: flowsPath });
  const snapshots = new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR });
  const staging = new StagedStore({ dir: config.STAGING_DIR });
  const audit = new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger });
  const containerFields = {
    config,
    flowSource,
    snapshots,
    staging,
    audit,
    auth: new NoAuth(),
    logger,
    clock: (): Date => new Date('2026-05-01T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  return {
    ctx: { ...containerFields, enrichAudit: () => undefined, container: containerFields },
    cleanup: async () => rm(root, { recursive: true, force: true }),
    reset: async () => staging.clear(),
  };
}

async function buildCtx(): Promise<{ ctx: ToolContext; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'auth-tools-'));
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
  const flowSource = new FileFlowSource({ path: flowsPath });
  const snapshots = new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR });
  const staging = new StagedStore({ dir: config.STAGING_DIR });
  const audit = new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger });
  const fixedClock = (): Date => new Date('2026-05-01T00:00:00.000Z');

  const containerFields = {
    config,
    flowSource,
    snapshots,
    staging,
    audit,
    auth: new NoAuth(),
    logger,
    clock: fixedClock,
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  const builtCtx: ToolContext = {
    ...containerFields,
    enrichAudit: () => undefined,
    container: containerFields,
  };
  return {
    ctx: builtCtx,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

beforeEach(async () => {
  const built = await buildCtx();
  ctx = built.ctx;
  cleanup = built.cleanup;
});

afterEach(async () => {
  await cleanup();
});

const HEX16 = /^[0-9a-f]{16}$/;

describe('author tools (workflow node tools)', () => {
  it('add_inject_node stages a new inject node', async () => {
    const out = (await addInjectNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_function_node stages a new function node', async () => {
    const out = (await addFunctionNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_catch_node stages a new catch node', async () => {
    const out = (await addCatchNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_status_node stages a new status node', async () => {
    const out = (await addStatusNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_complete_node stages a new complete node', async () => {
    const out = (await addCompleteNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_mqtt_in_node stages a new mqtt in node', async () => {
    const out = (await addMqttInNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_mqtt_out_node stages a new mqtt out node', async () => {
    const out = (await addMqttOutNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_link_in_node stages a new link in node', async () => {
    const out = (await addLinkInNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_link_out_node stages a new link out node', async () => {
    const out = (await addLinkOutNodeTool.handler({ tab_id: 'tab1' }, ctx)) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_link_call_node stages a new link call node', async () => {
    const out = (await addLinkCallNodeTool.handler(
      { tab_id: 'tab1', opts: { passthrough: { links: ['linkin1'] } } },
      ctx,
    )) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_subflow_instance stages a new subflow instance', async () => {
    const out = (await addSubflowInstanceTool.handler(
      { tab_id: 'tab1', defId: 'subflow1' },
      ctx,
    )) as AddNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_node_id).toMatch(HEX16);
  });

  it('add_subflow_instance resolves conf-type env values from config authoring keys in file mode', async () => {
    const cleanCtx = await rebuildCtx([
      { id: 'tab1', type: 'tab', label: 'Main', _authoringKey: 'tab1' },
      {
        id: 'subflow1',
        type: 'subflow',
        name: 'Reusable',
        env: [{ name: 'BROKER', type: 'conf-type', value: 'mqtt-broker' }],
        out: [{ x: 40, y: 80, wires: [] }],
        _authoringKey: 'subflow1',
      },
      {
        id: 'broker1',
        type: 'mqtt-broker',
        name: 'Broker A',
        broker: 'broker.example',
        port: 1883,
        _authoringKey: 'broker-a',
      },
    ]);
    try {
      const out = (await addSubflowInstanceTool.handler(
        {
          tab_id: 'tab1',
          defId: 'subflow1',
          opts: {
            env: [
              { name: 'BROKER', type: 'conf-type', value: 'broker-a' },
              { name: 'TOPIC', type: 'str', value: 'sensors/temperature' },
            ],
          },
        },
        cleanCtx.ctx,
      )) as AddNodeOutput;
      expect(out.ok).toBe(true);
      const staged = await cleanCtx.ctx.staging.read();
      const inst = staged?.flows.find(
        (n) => (n as Record<string, unknown>)['_authoringKey'] === 'subflow-subflow1',
      ) as Record<string, unknown> | undefined;
      expect((inst?.['env'] as Array<Record<string, unknown>>)[0]?.['value']).toBe('broker1');
      expect((inst?.['env'] as Array<Record<string, unknown>>)[1]).toEqual({
        name: 'TOPIC',
        type: 'str',
        value: 'sensors/temperature',
      });
    } finally {
      await cleanCtx.cleanup();
    }
  });

  it('add_subflow_instance refuses conf-type env overrides when runtime lacks subflowPerInstanceConfig', async () => {
    const cleanCtx = await rebuildCtx([
      { id: 'tab1', type: 'tab', label: 'Main', _authoringKey: 'tab1' },
      {
        id: 'subflow1',
        type: 'subflow',
        name: 'Reusable',
        env: [{ name: 'BROKER', type: 'conf-type', value: 'mqtt-broker' }],
        out: [{ x: 40, y: 80, wires: [] }],
        _authoringKey: 'subflow1',
      },
      {
        id: 'broker1',
        type: 'mqtt-broker',
        name: 'Broker A',
        broker: 'broker.example',
        port: 1883,
        _authoringKey: 'broker-a',
      },
    ]);
    try {
      (
        cleanCtx.ctx.container as unknown as {
          noderedClient: { getNoderedVersion: () => Promise<{ version: string }> };
        }
      ).noderedClient = {
        getNoderedVersion: () => Promise.resolve({ version: '3.1.11' }),
      };

      await expect(
        addSubflowInstanceTool.handler(
          {
            tab_id: 'tab1',
            defId: 'subflow1',
            opts: { env: [{ name: 'BROKER', type: 'conf-type', value: 'broker-a' }] },
          },
          cleanCtx.ctx,
        ),
      ).rejects.toThrow(/subflowPerInstanceConfig|Node-RED 4\.0/);
    } finally {
      await cleanCtx.cleanup();
    }
  });

  it('add_group stages a new group', async () => {
    const out = (await addGroupTool.handler(
      { tab_id: 'tab1', name: 'Group A' },
      ctx,
    )) as AddGroupOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_group_id).toMatch(HEX16);
  });

  it('add_group stages an explicit authoring key', async () => {
    const out = (await addGroupTool.handler(
      { tab_id: 'tab1', key: 'explicit-group', name: 'Group A' },
      ctx,
    )) as AddGroupOutput;
    expect(out.ok).toBe(true);
    expect(out.added_group_id).toMatch(HEX16);
    const staged = await ctx.staging.read();
    const group = staged?.flows.find(
      (n) => isGroup(n) && (n as Record<string, unknown>)['_authoringKey'] === 'explicit-group',
    );
    expect(group?.id).toBe(out.added_group_id);
  });

  it('add_group stages explicit group geometry and parent metadata', async () => {
    const cleanCtx = await rebuildCtx([
      { id: 'tab1', type: 'tab', label: 'Main', _authoringKey: 'tab1' },
      {
        id: 'node1',
        type: 'inject',
        z: 'tab1',
        x: 120,
        y: 120,
        wires: [[]],
        _authoringKey: 'source',
      },
      {
        id: 'parent1',
        type: 'group',
        z: 'tab1',
        name: 'Parent',
        nodes: [],
        x: 40,
        y: 40,
        w: 420,
        h: 240,
        _authoringKey: 'parent-group',
      },
    ]);
    try {
      const out = (await addGroupTool.handler(
        {
          tab_id: 'tab1',
          name: 'Child',
          node_keys: ['source'],
          position: { x: 80, y: 80 },
          size: { w: 240, h: 120 },
          parent_key: 'parent-group',
          info: 'Nested visual section',
          style: { fill: '#f5f5f5' },
        },
        cleanCtx.ctx,
      )) as AddGroupOutput;

      expect(out.ok).toBe(true);
      expect(out.added_group_id).toMatch(HEX16);
      const staged = await cleanCtx.ctx.staging.read();
      expect(staged).not.toBeNull();
      const group = staged?.flows.find((n) => isGroup(n) && n.id === out.added_group_id);
      expect(group).toMatchObject({
        type: 'group',
        z: 'tab1',
        name: 'Child',
        nodes: ['node1'],
        x: 80,
        y: 80,
        w: 240,
        h: 120,
        g: 'parent1',
        info: 'Nested visual section',
        style: { fill: '#f5f5f5' },
      });
    } finally {
      await cleanCtx.cleanup();
    }
  });

  it('add_comment stages a new comment', async () => {
    const out = (await addCommentTool.handler(
      { tab_id: 'tab1', text: 'Note', position: { x: 100, y: 280 } },
      ctx,
    )) as AddCommentOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.added_comment_id).toMatch(HEX16);
  });

  it('add_comment stages an explicit authoring key', async () => {
    const out = (await addCommentTool.handler(
      {
        tab_id: 'tab1',
        key: 'explicit-comment',
        text: 'Note',
        position: { x: 100, y: 280 },
      },
      ctx,
    )) as AddCommentOutput;
    expect(out.ok).toBe(true);
    expect(out.added_comment_id).toMatch(HEX16);
    const staged = await ctx.staging.read();
    const comment = staged?.flows.find(
      (n) => isComment(n) && (n as Record<string, unknown>)['_authoringKey'] === 'explicit-comment',
    );
    expect(comment?.id).toBe(out.added_comment_id);
  });

  it('update_group stages group updates and refit', async () => {
    const out = (await updateGroupTool.handler(
      {
        tab_id: 'tab1',
        group_key: 'existing-group',
        name: 'Updated Group',
        node_keys: ['source', 'existing-note'],
        refit: true,
      },
      ctx,
    )) as UpdateGroupOutput;
    expect(out.ok).toBe(true);
    expect(out.updated).toBe(true);
    expect(out.diff_summary.nodes_modified).toBeGreaterThan(0);
  });

  it('remove_group stages Node-RED ungroup removal', async () => {
    const out = (await removeGroupTool.handler(
      { tab_id: 'tab1', group_key: 'existing-group' },
      ctx,
    )) as RemoveGroupOutput;
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(true);
    expect(out.diff_summary.nodes_removed).toBe(1);
  });

  it('update_comment stages comment updates', async () => {
    const out = (await updateCommentTool.handler(
      {
        tab_id: 'tab1',
        comment_key: 'existing-note',
        text: 'Updated note',
        position: { x: 140, y: 340 },
      },
      ctx,
    )) as UpdateCommentOutput;
    expect(out.ok).toBe(true);
    expect(out.updated).toBe(true);
    expect(out.diff_summary.nodes_modified).toBe(1);
  });

  it('wire_nodes stages a new wire', async () => {
    const out = (await wireNodesTool.handler(
      { tab_id: 'tab1', from_key: 'source', to_key: 'target' },
      ctx,
    )) as WireNodesOutput;
    expect(out.ok).toBe(true);
    expect(out.wire_added).toBe(true);
    expect(out.diff_summary.wires_added).toBe(1);
  });

  it('remove_node stages node removal', async () => {
    const out = (await removeNodeTool.handler(
      { tab_id: 'tab1', node_key: 'target' },
      ctx,
    )) as RemoveNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(true);
    expect(out.diff_summary.nodes_removed).toBe(1);
  });

  it('update_node stages node updates', async () => {
    const out = (await updateNodeTool.handler(
      {
        tab_id: 'tab1',
        node_key: 'source',
        label: 'Updated Source',
        position: { x: 120, y: 180 },
        info: 'Updated source purpose.',
      },
      ctx,
    )) as UpdateNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.updated).toBe(true);
    expect(out.diff_summary.nodes_modified).toBe(1);
    const staged = await ctx.staging.read();
    const source = staged?.flows.find(
      (n) => (n as Record<string, unknown>)['_authoringKey'] === 'source',
    ) as Record<string, unknown> | undefined;
    expect(source?.['info']).toBe('Updated source purpose.');
  });

  it('move_node stages a cross-tab move', async () => {
    const out = (await moveNodeTool.handler(
      {
        source_tab_id: 'tab1',
        node_key: 'source',
        dest_tab_id: 'tab2',
        position: { x: 120, y: 120 },
      },
      ctx,
    )) as MoveNodeOutput;
    expect(out.ok).toBe(true);
    expect(out.moved_node_key).toBe('source');
    expect(out.source_tab_id).toBe('tab1');
    expect(out.dest_tab_id).toBe('tab2');
  });

  it('create_subflow_definition stages a new subflow definition', async () => {
    const out = (await createSubflowDefinitionTool.handler(
      {
        name: 'Created Subflow',
        env: [
          { name: 'BROKER', type: 'conf-type', value: 'mqtt-broker' },
          { name: 'TOPIC', type: 'str', value: 'sensors/temperature' },
        ],
      },
      ctx,
    )) as CreateSubflowDefinitionOutput;
    expect(out.ok).toBe(true);
    expect(out.diff_summary.nodes_added).toBe(1);
    expect(out.new_def_id).toMatch(HEX16);
    const staged = await ctx.staging.read();
    const def = staged?.flows.find(
      (n) => n.type === 'subflow' && (n as Record<string, unknown>)['name'] === 'Created Subflow',
    ) as Record<string, unknown> | undefined;
    expect(def?.['env']).toEqual([
      { name: 'BROKER', type: 'conf-type', value: 'mqtt-broker' },
      { name: 'TOPIC', type: 'str', value: 'sensors/temperature' },
    ]);
  });

  it('instantiate_template stages a built-in template', async () => {
    const out = (await instantiateTemplateTool.handler(
      { template_name: 'hello_world', params: { tab_label: 'Hello Tool' } },
      ctx,
    )) as InstantiateTemplateOutput;
    expect(out.ok).toBe(true);
    expect(out.template_name).toBe('hello_world');
    expect(out.diff_summary.nodes_added).toBe(3);
    expect(out.staged_hash.length).toBe(64);
  });

  it('author tools accept either Node-RED tab ID or _authoringKey for tab_id', async () => {
    // Custom flows where Node-RED ID and _authoringKey differ on the tab.
    const cleanCtx = await rebuildCtx([
      { id: 'nrid-alpha', type: 'tab', label: 'Aliased', _authoringKey: 'tab-alpha' },
    ]);
    try {
      const byKey = (await addInjectNodeTool.handler(
        { tab_id: 'tab-alpha' },
        cleanCtx.ctx,
      )) as AddNodeOutput;
      expect(byKey.ok).toBe(true);
      // Re-stage from scratch using the Node-RED ID this time.
      await cleanCtx.reset();
      const byNodeRedId = (await addInjectNodeTool.handler(
        { tab_id: 'nrid-alpha' },
        cleanCtx.ctx,
      )) as AddNodeOutput;
      expect(byNodeRedId.ok).toBe(true);
    } finally {
      await cleanCtx.cleanup();
    }
  });
});
