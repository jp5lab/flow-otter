/**
 * Casing/ownership/staleness tests for `get_staged_change` (WSB-6,
 * 2026-06-10 layout-audit fix plan, SD6):
 *
 * 1. DUAL-EMIT — canonical snake_case fields plus the deprecated camelCase
 *    duplicates, equal during the deprecation window (removal v2.0.0).
 * 2. OWNERSHIP — `agent_id` surfaced; `owned_by_current_session` mirrors
 *    deploy_staged_change's check (same session → true, foreign → false,
 *    pre-v0.6.0 stage without agent_id → true, back-compat).
 * 3. STALENESS — `stale` is true when staged bytes match the runtime
 *    (next author op auto-clears, WSB-3), false when they differ, null
 *    when the runtime cannot be read.
 * 4. PIPELINE — `staged_hash` feeds deploy_staged_change without renaming
 *    (pins the audit e2#7 casing mismatch).
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
import { deployStagedChangeTool } from '../../../../../src/server/tools/deploy/deploy-staged-change.js';
import { getStagedChangeTool } from '../../../../../src/server/tools/read/get-staged-change.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

// Compile fixed point so stagedHash-vs-runtime comparisons are byte-real
// (see stage-noop-guard.test.ts for the pattern).
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
  ],
};
const FIXTURE_FLOWS = compile(SPEC).flows;
const FIXTURE_HASH = canonicalHash(FIXTURE_FLOWS);

const OTHER_SPEC: AuthoringSpec = {
  tabs: [
    {
      ...SPEC.tabs[0]!,
      comments: [{ key: 'note1', text: 'undeployed work', position: { x: 100, y: 40 } }],
    },
  ],
};
const OTHER_FLOWS = compile(OTHER_SPEC).flows;
const OTHER_HASH = canonicalHash(OTHER_FLOWS);

let ctx: ToolContext;
let staging: StagedStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'get-staged-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(FIXTURE_FLOWS), 'utf8');
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

function writeStage(overrides: Partial<Parameters<StagedStore['write']>[0]> = {}): Promise<void> {
  return staging.write({
    flows: OTHER_FLOWS,
    basedOnSnapshotHash: FIXTURE_HASH,
    basedOnRev: null,
    stagedHash: OTHER_HASH,
    stagedAt: '2026-04-30T00:00:00.000Z',
    actor: 'unit-test',
    agent_id: 'pid-test',
    reason: 'test stage',
    ...overrides,
  });
}

describe('get_staged_change casing dual-emit (WSB-6)', () => {
  it('returns null when no staged change', async () => {
    const out = await getStagedChangeTool.handler({}, ctx);
    expect(out.staged).toBeNull();
  });

  it('emits canonical snake_case AND deprecated camelCase, equal during the window', async () => {
    await writeStage();
    const out = await getStagedChangeTool.handler({}, ctx);
    const s = out.staged!;
    expect(s.staged_hash).toBe(OTHER_HASH);
    expect(s.based_on_snapshot_hash).toBe(FIXTURE_HASH);
    expect(s.based_on_rev).toBeNull();
    expect(s.staged_at).toBe('2026-04-30T00:00:00.000Z');
    expect(s.actor).toBe('unit-test');
    expect(s.reason).toBe('test stage');
    // Legacy camelCase dual-emit — byte-equal to the canonical fields.
    expect(s.stagedHash).toBe(s.staged_hash);
    expect(s.basedOnSnapshotHash).toBe(s.based_on_snapshot_hash);
    expect(s.basedOnRev).toBe(s.based_on_rev);
    expect(s.stagedAt).toBe(s.staged_at);
  });

  it('output validates against the tool OutputSchema', async () => {
    await writeStage();
    const out = await getStagedChangeTool.handler({}, ctx);
    expect(() => getStagedChangeTool.outputZod!.parse(out)).not.toThrow();
  });
});

describe('get_staged_change ownership (WSB-6)', () => {
  it('same-session stage: agent_id surfaced, owned_by_current_session true', async () => {
    await writeStage({ agent_id: 'pid-test' });
    const out = await getStagedChangeTool.handler({}, ctx);
    expect(out.staged!.agent_id).toBe('pid-test');
    expect(out.staged!.owned_by_current_session).toBe(true);
  });

  it('foreign-session stage: owned_by_current_session false', async () => {
    await writeStage({ agent_id: 'pid-OTHER' });
    const out = await getStagedChangeTool.handler({}, ctx);
    expect(out.staged!.agent_id).toBe('pid-OTHER');
    expect(out.staged!.owned_by_current_session).toBe(false);
  });

  it('pre-v0.6.0 stage without agent_id: agent_id null, owned true (back-compat, mirrors deploy)', async () => {
    await staging.write({
      flows: OTHER_FLOWS,
      basedOnSnapshotHash: FIXTURE_HASH,
      basedOnRev: null,
      stagedHash: OTHER_HASH,
      stagedAt: '2026-04-30T00:00:00.000Z',
      actor: 'unit-test',
      reason: 'legacy stage',
    });
    const out = await getStagedChangeTool.handler({}, ctx);
    expect(out.staged!.agent_id).toBeNull();
    expect(out.staged!.owned_by_current_session).toBe(true);
  });
});

describe('get_staged_change staleness (WSB-6, WSB-3 semantics)', () => {
  it('stale=false when the staged bytes differ from the runtime', async () => {
    await writeStage();
    const out = await getStagedChangeTool.handler({}, ctx);
    expect(out.staged!.stale).toBe(false);
  });

  it('stale=true when the staged bytes are byte-identical to the runtime', async () => {
    await writeStage({ flows: FIXTURE_FLOWS, stagedHash: FIXTURE_HASH });
    const out = await getStagedChangeTool.handler({}, ctx);
    expect(out.staged!.stale).toBe(true);
  });

  it('stale=null when the runtime cannot be read (rest of the payload still served)', async () => {
    await writeStage();
    const brokenCtx: ToolContext = {
      ...ctx,
      flowSource: new FileFlowSource({ path: '/nonexistent/flows.json' }),
    };
    const out = await getStagedChangeTool.handler({}, brokenCtx);
    expect(out.staged).not.toBeNull();
    expect(out.staged!.stale).toBeNull();
    expect(out.staged!.staged_hash).toBe(OTHER_HASH);
  });
});

describe('staged_hash feeds deploy without renaming (e2#7 pin)', () => {
  it('stage → get_staged_change → deploy_staged_change with the snake_case hash succeeds', async () => {
    const stageOut = (await addCommentTool.handler({ tab_id: 'tab1', text: 'ship me' }, ctx)) as {
      ok: boolean;
    };
    expect(stageOut.ok).toBe(true);

    const read = await getStagedChangeTool.handler({}, ctx);
    expect(read.staged).not.toBeNull();
    expect(read.staged!.owned_by_current_session).toBe(true);
    expect(read.staged!.stale).toBe(false);

    // The whole point of the canonical casing: this value goes straight into
    // deploy_staged_change's `staged_hash` input, no renaming.
    const deployOut = (await deployStagedChangeTool.handler(
      { staged_hash: read.staged!.staged_hash, confirm: true },
      ctx,
    )) as { ok: boolean; deployed_hash: string };
    expect(deployOut.ok).toBe(true);
    expect(deployOut.deployed_hash).toBe(read.staged!.staged_hash);
    expect(await staging.read()).toBeNull();
  });
});
