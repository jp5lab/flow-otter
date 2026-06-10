/**
 * Guard tests for the stage-overwrite refusal (eval campaign 2026-06-10,
 * finding #1): author tools must refuse to stage over an undeployed change
 * instead of silently discarding it, and discard_staged_change is the
 * explicit escape hatch.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import { discardStagedChangeTool } from '../../../../../src/server/tools/author/discard-staged-change.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

const FIXTURE = [{ id: 'tab1', type: 'tab', label: 'Main' }];

let ctx: ToolContext;
let staging: StagedStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-guard-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(FIXTURE), 'utf8');
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
  const containerFields = {
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
  ctx = { ...containerFields, enrichAudit: () => undefined, container: containerFields };
  cleanup = async () => rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await cleanup();
});

describe('stage-overwrite guard', () => {
  it('refuses to stage a second op over an undeployed stage', async () => {
    const first = (await addCommentTool.handler({ tab_id: 'tab1', text: 'first' }, ctx)) as {
      ok: boolean;
      staged_hash: string;
    };
    expect(first.ok).toBe(true);
    await expect(addCommentTool.handler({ tab_id: 'tab1', text: 'second' }, ctx)).rejects.toThrow(
      /pending deploy.*discard_staged_change/s,
    );
    // The original stage is untouched.
    const staged = await staging.read();
    expect(staged?.stagedHash).toBe(first.staged_hash);
  });

  it('discard_staged_change clears the stage and unblocks new ops', async () => {
    const first = (await addCommentTool.handler({ tab_id: 'tab1', text: 'first' }, ctx)) as {
      staged_hash: string;
    };
    const out = (await discardStagedChangeTool.handler(
      { staged_hash: first.staged_hash },
      ctx,
    )) as { ok: boolean; discarded: boolean; staged_hash: string | null };
    expect(out.discarded).toBe(true);
    expect(out.staged_hash).toBe(first.staged_hash);
    const second = (await addCommentTool.handler({ tab_id: 'tab1', text: 'second' }, ctx)) as {
      ok: boolean;
    };
    expect(second.ok).toBe(true);
  });

  it('discard with a mismatched staged_hash refuses', async () => {
    await addCommentTool.handler({ tab_id: 'tab1', text: 'first' }, ctx);
    await expect(
      discardStagedChangeTool.handler({ staged_hash: 'not-the-hash' }, ctx),
    ).rejects.toThrow(/hash mismatch/i);
    expect(await staging.read()).not.toBeNull();
  });

  it('discard of another agent process stage needs force_takeover', async () => {
    await addCommentTool.handler({ tab_id: 'tab1', text: 'first' }, ctx);
    const staged = (await staging.read())!;
    await staging.write({ ...staged, agent_id: 'pid-OTHER' });
    await expect(discardStagedChangeTool.handler({}, ctx)).rejects.toThrow(/force_takeover/);
    const out = (await discardStagedChangeTool.handler({ force_takeover: true }, ctx)) as {
      discarded: boolean;
    };
    expect(out.discarded).toBe(true);
  });

  it('discard with nothing staged is a no-op', async () => {
    const out = (await discardStagedChangeTool.handler({}, ctx)) as {
      ok: boolean;
      discarded: boolean;
      staged_hash: string | null;
    };
    expect(out.ok).toBe(true);
    expect(out.discarded).toBe(false);
    expect(out.staged_hash).toBeNull();
  });

  it('deduplicates identical diagnostics across validator and lint passes', async () => {
    // An off-grid node trips the on-grid rule in BOTH the validator and the
    // lint pass; the staged-op response must surface it once, not twice.
    const out = (await addCommentTool.handler(
      { tab_id: 'tab1', text: 'off-grid', position: { x: 137, y: 91 } },
      ctx,
    )) as {
      diagnostics: Array<{ severity: string; rule: string; nodeId?: string; message: string }>;
    };
    const keys = out.diagnostics.map(
      (d) => `${d.severity}|${d.rule}|${d.nodeId ?? ''}|${d.message}`,
    );
    expect(new Set(keys).size, 'diagnostics should be unique').toBe(keys.length);
    const onGrid = out.diagnostics.filter((d) => d.rule === 'on-grid');
    // The off-grid comment yields exactly one on-grid diagnostic, not duplicates.
    expect(onGrid.length).toBeLessThanOrEqual(1);
  });
});
