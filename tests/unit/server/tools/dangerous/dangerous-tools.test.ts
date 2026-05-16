import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import { ALL_TOOLS } from '../../../../../src/server/index.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { deleteTabTool } from '../../../../../src/server/tools/dangerous/delete-tab.js';
import { DANGEROUS_CONFIRMATION_TEXT } from '../../../../../src/server/tools/dangerous/_confirmation.js';
import { prepareDangerousOperationTool } from '../../../../../src/server/tools/dangerous/prepare-dangerous-operation.js';
import { replaceFlowsTool } from '../../../../../src/server/tools/dangerous/replace-flows.js';
import { resetRuntimeTool } from '../../../../../src/server/tools/dangerous/reset-runtime.js';
import { buildRegistry } from '../../../../../src/server/tools/register.js';
import type { FlowsJson } from '../../../../../src/shared/flows-json.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const SAMPLE: FlowsJson = [
  { id: 'tab1', type: 'tab', label: 'Main' },
  { id: 'tab2', type: 'tab', label: 'Aux' },
  { id: 'n1', type: 'inject', z: 'tab1', x: 100, y: 100, wires: [] },
  { id: 'n2', type: 'debug', z: 'tab2', x: 300, y: 100, wires: [] },
];

let ctx: ToolContext;
let flowsPath: string;
let cleanup: () => Promise<void>;

async function buildCtx(
  extraEnv: Record<string, string> = {},
): Promise<{ ctx: ToolContext; flowsPath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'danger-tools-'));
  const filePath = path.join(root, 'flows.json');
  await writeFile(filePath, JSON.stringify(SAMPLE), 'utf8');

  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: filePath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    LOG_LEVEL: 'silent',
    ENVIRONMENT_NAME: 'unit',
    ACTOR_NAME: 'unit-test',
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_DEPLOY_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
    ...extraEnv,
  });
  const logger = createLogger({ level: 'silent' });
  const containerFields = {
    config,
    flowSource: new FileFlowSource({ path: filePath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging: new StagedStore({ dir: config.STAGING_DIR }),
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: () => new Date('2026-05-01T00:00:00.000Z'),
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
    flowsPath: filePath,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function readFlows(): Promise<FlowsJson> {
  return JSON.parse(await readFile(flowsPath, 'utf8')) as FlowsJson;
}

async function token(input: {
  operation: 'replace_flows' | 'delete_tab' | 'reset_runtime';
  target?: string;
  flows_hash?: string;
}): Promise<string> {
  const out = (await prepareDangerousOperationTool.handler(
    {
      ...input,
      confirmation_text: DANGEROUS_CONFIRMATION_TEXT,
    },
    ctx,
  )) as { confirmation_token: string };
  return out.confirmation_token;
}

beforeEach(async () => {
  const built = await buildCtx({ ENABLE_DANGEROUS_TOOLS: 'true' });
  ctx = built.ctx;
  flowsPath = built.flowsPath;
  cleanup = built.cleanup;
});

afterEach(async () => {
  await cleanup();
});

describe('dangerous tools', () => {
  it('are hidden unless ENABLE_DANGEROUS_TOOLS is true', async () => {
    const disabled = await buildCtx({ ENABLE_DANGEROUS_TOOLS: 'false' });
    const disabledNames = buildRegistry(disabled.ctx, ALL_TOOLS)
      .listTools()
      .map((t) => t.name);
    expect(disabledNames).not.toContain('delete_tab');
    await disabled.cleanup();

    const enabledNames = buildRegistry(ctx, ALL_TOOLS)
      .listTools()
      .map((t) => t.name);
    expect(enabledNames).toContain('prepare_dangerous_operation');
    expect(enabledNames).toContain('replace_flows');
    expect(enabledNames).toContain('delete_tab');
    expect(enabledNames).toContain('reset_runtime');
  });

  it('replace_flows replaces the whole document after token confirmation', async () => {
    const replacement: FlowsJson = [{ id: 'tab3', type: 'tab', label: 'Replacement' }];
    const confirmation = await token({
      operation: 'replace_flows',
      flows_hash: canonicalHash(replacement),
    });
    const out = (await replaceFlowsTool.handler(
      { flows: replacement, confirmation_token: confirmation },
      ctx,
    )) as { ok: boolean; replaced_hash: string };
    expect(out.ok).toBe(true);
    expect(out.replaced_hash).toBe(canonicalHash(replacement));
    expect(await readFlows()).toEqual(replacement);
  });

  it('delete_tab removes the tab and its contained nodes', async () => {
    const confirmation = await token({ operation: 'delete_tab', target: 'tab1' });
    const out = (await deleteTabTool.handler(
      { tab_id: 'tab1', confirmation_token: confirmation },
      ctx,
    )) as { ok: boolean; removed_count: number };
    expect(out.ok).toBe(true);
    expect(out.removed_count).toBe(2);
    expect((await readFlows()).map((n) => n.id).sort()).toEqual(['n2', 'tab2']);
  });

  it('reset_runtime clears all flows', async () => {
    const confirmation = await token({ operation: 'reset_runtime' });
    const out = (await resetRuntimeTool.handler({ confirmation_token: confirmation }, ctx)) as {
      ok: boolean;
      reset_hash: string;
    };
    expect(out.ok).toBe(true);
    expect(out.reset_hash).toBe(canonicalHash([]));
    expect(await readFlows()).toEqual([]);
  });

  it('rejects an invalid confirmation token', async () => {
    await expect(
      deleteTabTool.handler({ tab_id: 'tab1', confirmation_token: 'wrong' }, ctx),
    ).rejects.toThrow(/Invalid confirmation_token/);
  });
});
