/**
 * Guard tests for WSB-3 (2026-06-10 layout-audit fix plan):
 *
 * 1. NO-OP REFUSAL — an author op whose compiled output is byte-identical to
 *    the current runtime flows is refused at stage time (ValidationFailedError)
 *    and writes NOTHING to the staging slot. This kills the e1 poison cascade
 *    where silent-false ops (node tools addressed at junctions/comments) staged
 *    no-change stages that later tripped REQUIRE_DIFF_BEFORE_DEPLOY.
 *
 * 2. AUTO-CLEAR — a pending stage whose staged_hash is byte-identical to the
 *    current runtime flows carries no undeployed work; it is auto-cleared
 *    (regardless of which agent process staged it) with an info diagnostic
 *    `staging/auto-cleared-stale-stage`, and the new op proceeds. Pins the e2
 *    restart friction. A hash-UNEQUAL pending stage still blocks, and the
 *    refusal names force_takeover so a foreign-agent stage is recoverable.
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
import { removeNodeTool } from '../../../../../src/server/tools/author/remove-node.js';
import { updateNodeTool } from '../../../../../src/server/tools/author/update-node.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

// The runtime fixture must be a compile fixed point (decompile→compile is
// byte-identical only for compiler-shaped flows), so the no-op guard's hash
// comparison is exercised for real. Build it by compiling a spec that holds
// a regular node, a comment, AND a junction — the kinds the silent-false op
// bug confused.
const SPEC: AuthoringSpec = {
  tabs: [
    {
      id: 'tab1',
      label: 'Main',
      nodes: [{ key: 'source', type: 'inject', label: 'Source', position: { x: 100, y: 100 } }],
      connections: [],
      groups: [],
      comments: [{ key: 'note1', text: 'A note', position: { x: 100, y: 40 } }],
      junctions: [{ key: 'j1', position: { x: 220, y: 100 } }],
    },
  ],
};
const FIXTURE_FLOWS = compile(SPEC).flows;
const FIXTURE_HASH = canonicalHash(FIXTURE_FLOWS);

// A different (non-stale) staged payload for the hash-unequal block test.
const OTHER_SPEC: AuthoringSpec = {
  tabs: [
    {
      ...SPEC.tabs[0]!,
      comments: [
        ...SPEC.tabs[0]!.comments,
        { key: 'note2', text: 'More', position: { x: 100, y: 60 } },
      ],
    },
  ],
};
const OTHER_FLOWS = compile(OTHER_SPEC).flows;
const OTHER_HASH = canonicalHash(OTHER_FLOWS);

let ctx: ToolContext;
let staging: StagedStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-noop-'));
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

function staleStage(overrides: { agent_id?: string } = {}): Parameters<StagedStore['write']>[0] {
  return {
    flows: FIXTURE_FLOWS,
    basedOnSnapshotHash: FIXTURE_HASH,
    basedOnRev: null,
    stagedHash: FIXTURE_HASH,
    stagedAt: '2026-04-30T00:00:00.000Z',
    actor: 'unit-test',
    agent_id: overrides.agent_id ?? 'pid-OTHER',
    reason: 'stale leftover',
  };
}

describe('stage-time no-op refusal (WSB-3)', () => {
  it('remove_node addressing a comment key is refused and the slot stays empty', async () => {
    await expect(
      removeNodeTool.handler({ tab_id: 'tab1', node_key: 'note1' }, ctx),
    ).rejects.toThrow(/produced no change/);
    expect(await staging.read()).toBeNull();
  });

  it('update_node addressing a junction key is refused and the slot stays empty', async () => {
    await expect(
      updateNodeTool.handler({ tab_id: 'tab1', node_key: 'j1', position: { x: 300, y: 140 } }, ctx),
    ).rejects.toThrow(/produced no change/);
    expect(await staging.read()).toBeNull();
  });

  it('value-identical update_node is refused and the slot stays empty', async () => {
    await expect(
      updateNodeTool.handler(
        { tab_id: 'tab1', node_key: 'source', label: 'Source', position: { x: 100, y: 100 } },
        ctx,
      ),
    ).rejects.toThrow(/produced no change/);
    expect(await staging.read()).toBeNull();
  });

  it('the refusal points at the object-kind confusion (node vs junction vs comment vs group)', async () => {
    await expect(
      removeNodeTool.handler({ tab_id: 'tab1', node_key: 'note1' }, ctx),
    ).rejects.toThrow(/junction|comment|group/);
  });

  it('a real change still stages normally', async () => {
    const out = (await addCommentTool.handler({ tab_id: 'tab1', text: 'new note' }, ctx)) as {
      ok: boolean;
      staged_hash: string;
    };
    expect(out.ok).toBe(true);
    expect((await staging.read())?.stagedHash).toBe(out.staged_hash);
  });
});

describe('hash-equal stale-stage auto-clear (WSB-3)', () => {
  it('a foreign-agent stage byte-identical to the runtime is auto-cleared and the op proceeds', async () => {
    await staging.write(staleStage({ agent_id: 'pid-OTHER' }));
    const out = (await addCommentTool.handler({ tab_id: 'tab1', text: 'after restart' }, ctx)) as {
      ok: boolean;
      staged_hash: string;
      diagnostics: Array<{ severity: string; rule: string; message: string }>;
    };
    expect(out.ok).toBe(true);
    const cleared = out.diagnostics.find((d) => d.rule === 'staging/auto-cleared-stale-stage');
    expect(cleared).toBeDefined();
    expect(cleared!.severity).toBe('info');
    // The new stage replaced the stale one.
    const staged = await staging.read();
    expect(staged?.stagedHash).toBe(out.staged_hash);
    expect(staged?.stagedHash).not.toBe(FIXTURE_HASH);
    expect(staged?.agent_id).toBe('pid-test');
  });

  it('a same-agent hash-equal stale stage is auto-cleared too (agent_id does not matter)', async () => {
    await staging.write(staleStage({ agent_id: 'pid-test' }));
    const out = (await addCommentTool.handler({ tab_id: 'tab1', text: 'same agent' }, ctx)) as {
      ok: boolean;
      diagnostics: Array<{ rule: string }>;
    };
    expect(out.ok).toBe(true);
    expect(out.diagnostics.some((d) => d.rule === 'staging/auto-cleared-stale-stage')).toBe(true);
  });

  it('a hash-UNEQUAL pending stage still blocks and the refusal names force_takeover', async () => {
    await staging.write({
      ...staleStage({ agent_id: 'pid-OTHER' }),
      flows: OTHER_FLOWS,
      stagedHash: OTHER_HASH,
      reason: 'real undeployed work',
    });
    await expect(addCommentTool.handler({ tab_id: 'tab1', text: 'blocked' }, ctx)).rejects.toThrow(
      /pending deploy[\s\S]*force_takeover/,
    );
    // The pending stage is untouched — auto-clear must never fire on unequal hashes.
    expect((await staging.read())?.stagedHash).toBe(OTHER_HASH);
  });
});
