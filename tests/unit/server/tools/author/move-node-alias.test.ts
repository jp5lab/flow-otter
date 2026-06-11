/**
 * `tab_id` alias on move_node (WSB-6, 2026-06-10 layout-audit fix plan,
 * audit ledger e3#2): move_node was the one author tool that named its tab
 * parameter `source_tab_id`. The canonical spelling is now `tab_id`
 * (matching every other tool); `source_tab_id` stays accepted as a
 * deprecated alias (removal slated v2.0.0) so existing callers are
 * untouched — the alias is strictly additive. Using the alias triggers the
 * `param-vocabulary` soft nudge through the real invoke pipeline.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { Container } from '../../../../../src/server/container.js';
import { makeInvokable, type ToolContext } from '../../../../../src/server/tools/_tool.js';
import { moveNodeTool } from '../../../../../src/server/tools/author/move-node.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tab1',
      label: 'Main',
      nodes: [{ key: 'source', type: 'inject', label: 'Source', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [],
      junctions: [],
    },
    {
      id: 'tab2',
      label: 'Second',
      nodes: [],
      connections: [],
      groups: [],
      comments: [],
      junctions: [],
    },
  ],
};
const FIXTURE_FLOWS = compile(SPEC).flows;

interface MoveOut {
  ok: boolean;
  moved_node_key: string;
  source_tab_id: string;
  dest_tab_id: string;
  _guidance?: string[];
}

let ctx: ToolContext;
let container: Container;
let staging: StagedStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'move-alias-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(FIXTURE_FLOWS), 'utf8');
  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
  });
  const logger = createLogger({ level: 'silent' });
  staging = new StagedStore({ dir: config.STAGING_DIR });
  container = {
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
  ctx = { ...container, enrichAudit: () => undefined, container };
  cleanup = async () => rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await cleanup();
});

describe('move_node input schema: tab_id alias (WSB-6)', () => {
  it('accepts canonical tab_id', () => {
    const parsed = moveNodeTool.inputZod.safeParse({ tab_id: 'tab1', node_key: 'source' });
    expect(parsed.success).toBe(true);
  });

  it('still accepts the deprecated source_tab_id (alias is additive)', () => {
    const parsed = moveNodeTool.inputZod.safeParse({ source_tab_id: 'tab1', node_key: 'source' });
    expect(parsed.success).toBe(true);
  });

  it('accepts both spellings when they agree', () => {
    const parsed = moveNodeTool.inputZod.safeParse({
      tab_id: 'tab1',
      source_tab_id: 'tab1',
      node_key: 'source',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when neither spelling is supplied, naming tab_id as required', () => {
    const parsed = moveNodeTool.inputZod.safeParse({ node_key: 'source' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message).join(' ')).toMatch(/tab_id is required/);
    }
  });

  it('rejects when the two spellings disagree', () => {
    const parsed = moveNodeTool.inputZod.safeParse({
      tab_id: 'tab1',
      source_tab_id: 'tab2',
      node_key: 'source',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message).join(' ')).toMatch(/disagree/);
    }
  });

  it('the JSON schema requires one of the two spellings', () => {
    const schema = moveNodeTool.inputJsonSchema as {
      required: string[];
      anyOf: Array<{ required: string[] }>;
    };
    expect(schema.required).toEqual(['node_key']);
    expect(schema.anyOf).toEqual([{ required: ['tab_id'] }, { required: ['source_tab_id'] }]);
  });
});

describe('move_node handler with the alias forms', () => {
  it('stages a cross-tab move via canonical tab_id', async () => {
    const out = (await moveNodeTool.handler(
      { tab_id: 'tab1', node_key: 'source', dest_tab_id: 'tab2', position: { x: 120, y: 120 } },
      ctx,
    )) as MoveOut;
    expect(out.ok).toBe(true);
    expect(out.moved_node_key).toBe('source');
    expect(out.source_tab_id).toBe('tab1');
    expect(out.dest_tab_id).toBe('tab2');
  });

  it('stages the identical move via the deprecated source_tab_id', async () => {
    const out = (await moveNodeTool.handler(
      {
        source_tab_id: 'tab1',
        node_key: 'source',
        dest_tab_id: 'tab2',
        position: { x: 120, y: 120 },
      },
      ctx,
    )) as MoveOut;
    expect(out.ok).toBe(true);
    expect(out.source_tab_id).toBe('tab1');
    expect(out.dest_tab_id).toBe('tab2');
  });
});

describe('param-vocabulary nudge through the real invoke pipeline (e3#2)', () => {
  it('using source_tab_id appends the param-vocabulary guidance', async () => {
    const invokable = makeInvokable(moveNodeTool);
    const out = (await invokable.invoke(
      {
        source_tab_id: 'tab1',
        node_key: 'source',
        dest_tab_id: 'tab2',
        position: { x: 120, y: 120 },
      },
      container,
    )) as MoveOut;
    expect(out.ok).toBe(true);
    const guidance = out._guidance ?? [];
    expect(guidance.some((g) => g.startsWith('[param-vocabulary]'))).toBe(true);
    expect(guidance.join(' ')).toContain('tab_id');
  });

  it('using canonical tab_id emits no param-vocabulary guidance', async () => {
    const invokable = makeInvokable(moveNodeTool);
    const out = (await invokable.invoke(
      { tab_id: 'tab1', node_key: 'source', dest_tab_id: 'tab2', position: { x: 120, y: 120 } },
      container,
    )) as MoveOut;
    expect(out.ok).toBe(true);
    const guidance = out._guidance ?? [];
    expect(guidance.some((g) => g.startsWith('[param-vocabulary]'))).toBe(false);
  });
});
