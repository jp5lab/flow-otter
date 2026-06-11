/**
 * Pins for WSB-5-PR1 (2026-06-10 layout-audit fix plan): the pure extraction
 * of `compileValidateAndStage` from `runStagedAuthorOp` plus the async-op
 * widening. Zero behavior change is the contract — these tests pin it:
 *
 * 1. HASH STABILITY — staging the identical op against the identical runtime
 *    yields a byte-identical `staged_hash` and byte-identical staged flows
 *    (the explicit staged_hash byte-identity regression the plan requires).
 * 2. ASYNC-OP WIDENING — an async `op` callback stages identically to its
 *    sync twin (`runStagedAuthorOp` now accepts both).
 * 3. EXTRACTED TAIL — `compileValidateAndStage` called directly preserves the
 *    WSB-3 invariants that later items (REND-8, D-3, LAYO-6) must re-run:
 *    `based_on_snapshot_hash` = the single-load prior hash, the no-op refusal
 *    is the first check after compile (slot untouched), and the auto-clear
 *    diagnostic threads through PREPENDED to the stage-output diagnostics.
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
import {
  compileValidateAndStage,
  runStagedAuthorOp,
} from '../../../../../src/server/tools/author/_stage-pipeline.js';
import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import { decompile } from '../../../../../src/toolkit/authoring/decompile.js';
import { addComment } from '../../../../../src/toolkit/authoring/operations/add-comment.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

// The runtime fixture must be a compile fixed point (decompile→compile is
// byte-identical only for compiler-shaped flows) so the no-op refusal and the
// hash comparisons are exercised for real.
const SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tab1',
      label: 'Main',
      nodes: [{ key: 'source', type: 'inject', label: 'Source', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [{ key: 'note1', text: 'A note', position: { x: 100, y: 40 } }],
      junctions: [],
    },
  ],
};
const FIXTURE_FLOWS = compile(SPEC).flows;
const FIXTURE_HASH = canonicalHash(FIXTURE_FLOWS);
const FIXTURE_PRIOR = { flows: FIXTURE_FLOWS, hash: FIXTURE_HASH, rev: null };

let ctx: ToolContext;
let staging: StagedStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-extract-'));
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

describe('staged_hash byte-identity (WSB-5-PR1 refactor pin)', () => {
  it('staging the identical op twice yields identical staged_hash and byte-identical flows', async () => {
    const first = (await addCommentTool.handler(
      { tab_id: 'tab1', text: 'same op', position: { x: 100, y: 80 } },
      ctx,
    )) as { staged_hash: string };
    const firstStaged = await staging.read();
    expect(firstStaged).not.toBeNull();

    await staging.clear();

    const second = (await addCommentTool.handler(
      { tab_id: 'tab1', text: 'same op', position: { x: 100, y: 80 } },
      ctx,
    )) as { staged_hash: string };
    const secondStaged = await staging.read();

    expect(second.staged_hash).toBe(first.staged_hash);
    expect(JSON.stringify(secondStaged!.flows)).toBe(JSON.stringify(firstStaged!.flows));
    expect(secondStaged!.basedOnSnapshotHash).toBe(firstStaged!.basedOnSnapshotHash);
  });
});

describe('async-op widening (WSB-5-PR1)', () => {
  const opBody = (priorSpec: AuthoringSpec) => {
    const { spec: nextSpec } = addComment(priorSpec, 'tab1', {
      text: 'widened',
      position: { x: 100, y: 80 },
    });
    return { nextSpec, extras: null };
  };

  it('an async op stages identically to its sync twin', async () => {
    const syncHash = await runStagedAuthorOp(
      ctx,
      { toolName: 'sync_op' },
      (priorSpec) => opBody(priorSpec),
      (base) => base.staged_hash,
    );
    await staging.clear();

    const asyncHash = await runStagedAuthorOp(
      ctx,
      { toolName: 'async_op' },
      async (priorSpec) => {
        await Promise.resolve();
        return opBody(priorSpec);
      },
      (base) => base.staged_hash,
    );

    expect(asyncHash).toBe(syncHash);
    expect((await staging.read())?.stagedHash).toBe(syncHash);
  });
});

describe('compileValidateAndStage (extracted tail)', () => {
  it('based_on_snapshot_hash equals the prior hash handed in (single-load baseline)', async () => {
    const priorSpec = decompile(FIXTURE_FLOWS);
    const { spec: nextSpec } = addComment(priorSpec, 'tab1', { text: 'direct call' });

    const base = await compileValidateAndStage(ctx, FIXTURE_PRIOR, nextSpec, {
      toolName: 'direct_test',
    });

    expect(base.ok).toBe(true);
    expect(base.based_on_snapshot_hash).toBe(FIXTURE_HASH);
    expect(base.staged_hash).toBe(canonicalHash(base.compiledFlows));

    const staged = await staging.read();
    expect(staged?.stagedHash).toBe(base.staged_hash);
    expect(staged?.basedOnSnapshotHash).toBe(FIXTURE_HASH);
    expect(staged?.reason).toBe('direct_test');
  });

  it('a no-op spec is refused first after compile and nothing is written', async () => {
    const priorSpec = decompile(FIXTURE_FLOWS);
    await expect(
      compileValidateAndStage(ctx, FIXTURE_PRIOR, priorSpec, { toolName: 'noop_test' }),
    ).rejects.toThrow(/produced no change/);
    expect(await staging.read()).toBeNull();
  });

  it('meta.autoClearDiagnostic threads through PREPENDED to the stage-output diagnostics', async () => {
    const diag = {
      severity: 'info' as const,
      rule: 'staging/auto-cleared-stale-stage',
      message: 'threaded through the extracted tail',
    };
    const priorSpec = decompile(FIXTURE_FLOWS);
    const { spec: nextSpec } = addComment(priorSpec, 'tab1', { text: 'with diag' });

    const base = await compileValidateAndStage(ctx, FIXTURE_PRIOR, nextSpec, {
      toolName: 'thread_test',
      autoClearDiagnostic: diag,
    });

    expect(base.diagnostics[0]).toEqual(diag);
  });
});
