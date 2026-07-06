import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import { deployStagedChangeTool } from '../../../../../src/server/tools/deploy/deploy-staged-change.js';
import { rollbackLastChangeTool } from '../../../../../src/server/tools/deploy/rollback-last-change.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { addCommentTool } from '../../../../../src/server/tools/author/add-comment.js';
import { stageChangesTool } from '../../../../../src/server/tools/author/stage-changes.js';
import { toolErrorPayload } from '../../../../../src/server/transport/tool-error.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
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
      nodes: [
        {
          key: 'source',
          type: 'inject',
          label: 'Source',
          position: { x: 100, y: 100 },
        },
        {
          key: 'worker',
          type: 'function',
          label: 'Worker',
          position: { x: 260, y: 100 },
          passthrough: { func: 'return msg;', outputs: 1 },
        },
        {
          key: 'target',
          type: 'debug',
          label: 'Target',
          position: { x: 420, y: 100 },
        },
        {
          key: 'replace',
          type: 'function',
          label: 'Replace',
          position: { x: 100, y: 220 },
          passthrough: { func: 'return msg;', outputs: 1 },
        },
      ],
      connections: [{ fromKey: 'source', outputPort: 0, toKey: 'worker' }],
      groups: [],
      comments: [],
      junctions: [],
    },
  ],
};

const FIXTURE_FLOWS = compile(SPEC).flows;
const FIXTURE_HASH = canonicalHash(FIXTURE_FLOWS);
const SOURCE_ID = idForKey('source');
const REPLACE_ID = idForKey('replace');

function idForKey(key: string): string {
  const found = FIXTURE_FLOWS.find((n) => (n as Record<string, unknown>)['_authoringKey'] === key);
  if (found === undefined) throw new Error(`fixture key '${key}' missing`);
  return found.id;
}

let ctx: ToolContext;
let staging: StagedStore;
let flowsPath: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-changes-'));
  flowsPath = path.join(root, 'flows.json');
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
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_DEPLOY_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
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

async function stage(input: Parameters<typeof stageChangesTool.handler>[0]) {
  return stageChangesTool.handler(input, ctx);
}

describe('stage_changes safety spine', () => {
  it('stages against the pre-batch runtime hash and deploy refuses after out-of-band drift', async () => {
    const out = await stage({
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'batched-note', text: 'batched' }],
    });
    expect(out.based_on_snapshot_hash).toBe(FIXTURE_HASH);
    expect((await staging.read())?.basedOnSnapshotHash).toBe(FIXTURE_HASH);

    const drifted = [
      ...FIXTURE_FLOWS,
      { id: 'aaaaaaaaaaaaaaaa', type: 'comment', z: 'tab1', x: 60, y: 60, name: 'drift' },
    ];
    await writeFile(flowsPath, JSON.stringify(drifted), 'utf8');

    await expect(
      deployStagedChangeTool.handler({ staged_hash: out.staged_hash, confirm: true }, ctx),
    ).rejects.toMatchObject({ name: 'DriftError' });
  });

  it('deploy snapshot plus rollback restores byte-identical runtime flows', async () => {
    const out = await stage({
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'rollback-note', text: 'rollback' }],
    });

    await deployStagedChangeTool.handler({ staged_hash: out.staged_hash, confirm: true }, ctx);
    expect(canonicalHash((await ctx.flowSource.load()).flows)).not.toBe(FIXTURE_HASH);

    const rollback = await rollbackLastChangeTool.handler({}, ctx);
    expect(rollback.restored_hash).toBe(FIXTURE_HASH);
    expect(canonicalHash((await ctx.flowSource.load()).flows)).toBe(FIXTURE_HASH);
  });

  it('blocks a non-equal pending stage before folding the batch', async () => {
    const first = await stage({
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'first', text: 'first' }],
    });

    await expect(
      stage({ ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'second', text: 'second' }] }),
    ).rejects.toThrow(/pending deploy.*discard_staged_change/s);
    expect((await staging.read())?.stagedHash).toBe(first.staged_hash);
  });
});

describe('stage_changes batch behavior', () => {
  it('orders ops left-to-right so a later wire can reference same-batch node keys', async () => {
    const out = await stage({
      ops: [
        {
          op: 'add_node',
          tab_id: 'tab1',
          type: 'function',
          opts: {
            key: 'k1',
            position: { x: 560, y: 100 },
            passthrough: { func: 'return msg;', outputs: 1 },
          },
        },
        {
          op: 'add_node',
          tab_id: 'tab1',
          type: 'debug',
          opts: { key: 'k2', position: { x: 720, y: 100 } },
        },
        { op: 'wire_nodes', tab_id: 'tab1', from_key: 'k1', to_key: 'k2' },
      ],
    });

    const staged = (await staging.read())!;
    const k1 = staged.flows.find(
      (n) => (n as Record<string, unknown>)['_authoringKey'] === 'k1',
    ) as { wires?: string[][] } | undefined;
    const k2 = staged.flows.find((n) => (n as Record<string, unknown>)['_authoringKey'] === 'k2');
    expect(out.op_results).toHaveLength(3);
    expect(k1?.wires).toEqual([[k2!.id]]);
  });

  it('resolves same-batch keys and pre-existing runtime ids in one batch', async () => {
    const out = await stage({
      ops: [
        {
          op: 'add_node',
          tab_id: 'tab1',
          type: 'function',
          opts: {
            key: 'from-runtime-id',
            source_node_id: SOURCE_ID,
            position: { x: 560, y: 180 },
            passthrough: { func: 'return msg;', outputs: 1 },
          },
        },
        {
          op: 'add_node',
          tab_id: 'tab1',
          type: 'debug',
          opts: {
            key: 'from-batch-key',
            source_node_id: 'from-runtime-id',
            position: { x: 720, y: 180 },
          },
        },
      ],
    });

    const staged = (await staging.read())!;
    const source = staged.flows.find((n) => n.id === SOURCE_ID) as { wires?: string[][] };
    const middle = staged.flows.find(
      (n) => (n as Record<string, unknown>)['_authoringKey'] === 'from-runtime-id',
    ) as { id: string; wires?: string[][] };
    const last = staged.flows.find(
      (n) => (n as Record<string, unknown>)['_authoringKey'] === 'from-batch-key',
    );
    expect(out.ok).toBe(true);
    expect(source.wires?.[0]).toContain(middle.id);
    expect(middle.wires?.[0]).toContain(last!.id);
  });

  it('resolves node_id against a pre-existing runtime id after current spec keys miss', async () => {
    await stage({
      ops: [{ op: 'update_node', tab_id: 'tab1', node_id: REPLACE_ID, label: 'Runtime id' }],
    });

    const staged = (await staging.read())!;
    const updated = staged.flows.find((n) => n.id === REPLACE_ID) as { name?: string };
    expect(updated.name).toBe('Runtime id');
  });

  it('remove-then-readd of the same tab kind key mints a fresh id', async () => {
    await stage({
      ops: [
        { op: 'remove_node', tab_id: 'tab1', node_id: 'replace' },
        {
          op: 'add_node',
          tab_id: 'tab1',
          type: 'debug',
          opts: { key: 'replace', position: { x: 100, y: 220 } },
        },
      ],
    });

    const staged = (await staging.read())!;
    const replacement = staged.flows.find(
      (n) => (n as Record<string, unknown>)['_authoringKey'] === 'replace',
    );
    expect(replacement?.id).toBeTruthy();
    expect(replacement?.id).not.toBe(REPLACE_ID);
  });

  it('failed ops are all-or-nothing and serialize failed_op_index plus failed_op', async () => {
    await expect(
      stage({
        ops: [
          { op: 'add_comment', tab_id: 'tab1', key: 'will-not-stage', text: 'nope' },
          { op: 'remove_node', tab_id: 'tab1', node_id: 'missing' },
        ],
      }),
    ).rejects.toMatchObject({ name: 'BatchOpError', failedOpIndex: 1 });
    expect(await staging.read()).toBeNull();

    const err = await stage({
      ops: [
        { op: 'add_comment', tab_id: 'tab1', key: 'will-not-stage', text: 'nope' },
        { op: 'remove_node', tab_id: 'tab1', node_id: 'missing' },
      ],
    }).catch((e: unknown) => e);
    expect(toolErrorPayload(err).error).toMatchObject({
      name: 'BatchOpError',
      failed_op_index: 1,
      failed_op: { op: 'remove_node', tab_id: 'tab1', node_id: 'missing' },
    });
  });

  it('post-compile lint errors abort the whole batch with diagnostics and no staged slot', async () => {
    const err = await stage({
      ops: [
        {
          op: 'add_node',
          tab_id: 'tab1',
          type: 'debug',
          opts: { key: 'off-canvas', position: { x: 99980, y: 100 } },
        },
      ],
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'ValidationFailedError' });
    expect(await staging.read()).toBeNull();
    const payload = toolErrorPayload(err).error;
    expect(payload.name).toBe('ValidationFailedError');
    expect(payload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'off-canvas' })]),
    );
  });

  it('dry_run validates and diffs but leaves the slot empty', async () => {
    const out = await stage({
      dry_run: true,
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'dry', text: 'dry' }],
    });

    expect(out.ok).toBe(true);
    expect(out.dry_run).toBe(true);
    expect(out.staged).toBe(false);
    expect(out.staged_hash).toBeTruthy();
    expect(await staging.read()).toBeNull();
  });

  it('net-zero batches are refused by the no-op guard and leave the slot empty', async () => {
    await expect(
      stage({
        ops: [
          { op: 'move_node', tab_id: 'tab1', node_id: 'worker', position: { x: 320, y: 160 } },
          { op: 'move_node', tab_id: 'tab1', node_id: 'worker', position: { x: 260, y: 100 } },
        ],
      }),
    ).rejects.toThrow(/produced no change/);
    expect(await staging.read()).toBeNull();
  });

  it('identical re-stage yields an identical staged_hash', async () => {
    const input = {
      ops: [{ op: 'add_comment' as const, tab_id: 'tab1', key: 'stable', text: 'stable' }],
    };
    const first = await stage(input);
    const firstFlows = (await staging.read())!.flows;
    await staging.clear();

    const second = await stage(input);
    const secondFlows = (await staging.read())!.flows;

    expect(second.staged_hash).toBe(first.staged_hash);
    expect(JSON.stringify(secondFlows)).toBe(JSON.stringify(firstFlows));
  });
});

describe('stage_changes amend_of', () => {
  it('replaces a pending stage when amend_of exactly matches the pending staged_hash', async () => {
    const first = await stage({
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'first', text: 'first' }],
    });

    const amended = await stage({
      amend_of: first.staged_hash,
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'amended', text: 'amended' }],
    });

    expect(amended.amended).toBe(true);
    expect(amended.staged_hash).not.toBe(first.staged_hash);
    expect((await staging.read())?.stagedHash).toBe(amended.staged_hash);
  });

  it('refuses stale or wrong amend_of hashes and leaves the pending stage untouched', async () => {
    const first = await stage({
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'first', text: 'first' }],
    });

    await expect(
      stage({
        amend_of: 'wrong-hash',
        ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'second', text: 'second' }],
      }),
    ).rejects.toThrow(/pending deploy.*discard_staged_change/s);
    expect((await staging.read())?.stagedHash).toBe(first.staged_hash);
  });

  it('without amend_of a pending stage is refused through the normal guard', async () => {
    const first = await stage({
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'first', text: 'first' }],
    });

    await expect(
      stage({ ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'second', text: 'second' }] }),
    ).rejects.toThrow(/pending deploy.*force_takeover/s);
    expect((await staging.read())?.stagedHash).toBe(first.staged_hash);
  });

  it('does not change single-op author tools: they still refuse over a pending stage', async () => {
    const first = await stage({
      ops: [{ op: 'add_comment', tab_id: 'tab1', key: 'first', text: 'first' }],
    });

    await expect(
      addCommentTool.handler({ tab_id: 'tab1', text: 'single op' }, ctx),
    ).rejects.toThrow(/pending deploy.*discard_staged_change/s);
    expect((await staging.read())?.stagedHash).toBe(first.staged_hash);
  });
});
