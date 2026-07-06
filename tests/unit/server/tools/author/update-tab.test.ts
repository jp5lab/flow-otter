import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { updateTabTool } from '../../../../../src/server/tools/author/update-tab.js';
import { isTab, type FlowsJson } from '../../../../../src/shared/flows-json.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import { decompile } from '../../../../../src/toolkit/authoring/decompile.js';
import { updateTab } from '../../../../../src/toolkit/authoring/operations/update-tab.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const BASE_FLOWS: FlowsJson = [
  {
    id: 'tab1',
    type: 'tab',
    label: 'Main',
    info: 'Original info',
    env: [
      { name: 'KEEP', type: 'str', value: 'yes' },
      { name: 'PORT', type: 'num', value: 1880 },
    ],
    _authoringKey: 'tab1',
  },
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

async function buildCtx(fixture: FlowsJson = BASE_FLOWS): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'update-tab-'));
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

describe('update_tab operation', () => {
  it('throws when the tab is missing', () => {
    expect(() => updateTab(EMPTY_SPEC, 'missing', { label: 'Renamed' })).toThrow(
      /Tab 'missing' not found/,
    );
  });

  it('throws when no update fields are supplied', () => {
    expect(() => updateTab(EMPTY_SPEC, 'tab1', {})).toThrow(/at least one field/);
  });

  it('replaces env wholesale', () => {
    const spec = decompile(BASE_FLOWS);
    const out = updateTab(spec, 'tab1', {
      env: [{ name: 'ONLY', type: 'bool', value: true }],
    });

    expect(out.updated).toBe(true);
    expect(out.spec.tabs[0]?.env).toEqual([{ name: 'ONLY', type: 'bool', value: true }]);
  });

  it('label, info, and env updates round-trip through compile idempotently', () => {
    const spec = decompile(BASE_FLOWS);
    const out = updateTab(spec, 'tab1', {
      label: 'Operations',
      info: 'Updated markdown',
      env: [
        { name: 'MODE', type: 'str', value: 'test' },
        { name: 'LIMIT', type: 'num', value: 42 },
      ],
    });
    const compiled = compile(out.spec, { prior: BASE_FLOWS }).flows;
    const roundTripped = compile(decompile(compiled), { prior: compiled }).flows;

    expect(canonicalHash(roundTripped)).toBe(canonicalHash(compiled));
    expect(compiled.find(isTab)).toMatchObject({
      id: 'tab1',
      label: 'Operations',
      info: 'Updated markdown',
      env: [
        { name: 'MODE', type: 'str', value: 'test' },
        { name: 'LIMIT', type: 'num', value: 42 },
      ],
    });
  });
});

describe('update_tab tool', () => {
  it('rejects non-empty values for cred env entries', async () => {
    await expect(
      updateTabTool.handler(
        {
          tab_id: 'tab1',
          env: [{ name: 'API_TOKEN', type: 'cred', value: 'secret' }],
        },
        ctx,
      ),
    ).rejects.toThrow(/credential values.*not authored/i);

    expect(await ctx.staging.read()).toBeNull();
  });

  it('allows declaring a cred env entry without a value', async () => {
    const out = (await updateTabTool.handler(
      {
        tab_id: 'tab1',
        env: [{ name: 'API_TOKEN', type: 'cred' }],
      },
      ctx,
    )) as { ok: boolean; updated: boolean; updated_tab_id: string };

    expect(out.ok).toBe(true);
    expect(out.updated).toBe(true);
    expect(out.updated_tab_id).toBe('tab1');

    const staged = await ctx.staging.read();
    const tab = staged?.flows.find(isTab);
    expect(tab?.env).toEqual([{ name: 'API_TOKEN', type: 'cred' }]);
  });

  it('stages label, info, and env updates with the expected output shape', async () => {
    const out = (await updateTabTool.handler(
      {
        tab_id: 'tab1',
        label: 'Updated Tab',
        info: 'Updated info',
        env: [{ name: 'MODE', type: 'str', value: 'test' }],
      },
      ctx,
    )) as {
      ok: boolean;
      updated: boolean;
      updated_tab_id: string;
      diff_summary: { nodes_modified: number };
    };

    expect(out.ok).toBe(true);
    expect(out.updated).toBe(true);
    expect(out.updated_tab_id).toBe('tab1');
    expect(out.diff_summary.nodes_modified).toBe(1);

    const staged = await ctx.staging.read();
    const tab = staged?.flows.find(isTab);
    expect(tab).toMatchObject({
      label: 'Updated Tab',
      info: 'Updated info',
      env: [{ name: 'MODE', type: 'str', value: 'test' }],
    });
  });
});
