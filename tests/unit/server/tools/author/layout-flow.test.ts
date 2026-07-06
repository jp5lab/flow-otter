import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import {
  ToolBlockedError,
  ValidationFailedError,
  type ToolContext,
} from '../../../../../src/server/tools/_tool.js';
import { layoutFlowTool } from '../../../../../src/server/tools/author/layout-flow.js';
import { isGroup } from '../../../../../src/shared/flows-json.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { diffFlows } from '../../../../../src/toolkit/diff/semantic.js';
import { stripLayoutGeometry } from '../../../../../src/toolkit/layout/index.js';
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
          position: { x: 520, y: 300 },
          groupKey: 'processing',
        },
        {
          key: 'worker',
          type: 'function',
          label: 'Worker',
          position: { x: 80, y: 500 },
          groupKey: 'processing',
          passthrough: { func: 'return msg;', outputs: 1 },
        },
        {
          key: 'target',
          type: 'debug',
          label: 'Target',
          position: { x: 260, y: 80 },
        },
        {
          key: 'status',
          type: 'status',
          label: 'Status',
          position: { x: 720, y: 120 },
        },
      ],
      connections: [
        { fromKey: 'source', outputPort: 0, toKey: 'worker' },
        { fromKey: 'worker', outputPort: 0, toKey: 'target' },
        { fromKey: 'status', outputPort: 0, toKey: 'worker' },
      ],
      groups: [
        {
          key: 'processing',
          name: 'Processing',
          nodeKeys: ['source', 'worker'],
          position: { x: 40, y: 40 },
          size: { w: 540, h: 360 },
        },
      ],
      comments: [{ key: 'note', text: 'Processing note', position: { x: 260, y: 20 } }],
      junctions: [],
    },
  ],
};

const FIXTURE_FLOWS = compile(SPEC).flows;

let ctx: ToolContext;
let staging: StagedStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'layout-flow-'));
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

function nodeByKey(flows: typeof FIXTURE_FLOWS, key: string): Record<string, unknown> {
  const found = flows.find((node) => (node as Record<string, unknown>)['_authoringKey'] === key);
  if (found === undefined) throw new Error(`missing key ${key}`);
  return found;
}

function authoringKeysById(flows: typeof FIXTURE_FLOWS): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const node of flows) out.set(node.id, (node as Record<string, unknown>)['_authoringKey']);
  return out;
}

describe('layout_flow', () => {
  it('enumerates every unknown tab/key reference in one ValidationFailedError', async () => {
    const err = await layoutFlowTool
      .handler(
        {
          tab_id: 'tab1',
          lane_hints: { missing_lane: 'main' },
          section_order: ['missing_section'],
          pinned: ['missing_pin'],
        },
        ctx,
      )
      .catch((error: unknown) => error);

    expect(err).toBeInstanceOf(ValidationFailedError);
    expect((err as Error).message).toContain('lane_hints: missing_lane');
    expect((err as Error).message).toContain('section_order: missing_section');
    expect((err as Error).message).toContain('pinned: missing_pin');
    expect((err as ValidationFailedError).diagnostics).toHaveLength(3);
  });

  it('dry_run validates and diffs without writing the staging slot', async () => {
    const out = await layoutFlowTool.handler({ tab_id: 'tab1', dry_run: true }, ctx);

    expect(out.ok).toBe(true);
    expect(out.dry_run).toBe(true);
    expect(out.staged).toBe(false);
    expect(out.diff_summary.nodes_added).toBe(0);
    expect(out.diff_summary.nodes_removed).toBe(0);
    expect(out.diff_summary.wires_added).toBe(0);
    expect(out.diff_summary.wires_removed).toBe(0);
    expect(await staging.read()).toBeNull();
  });

  it('keeps pinned object geometry byte-identical in the staged flows', async () => {
    await layoutFlowTool.handler({ tab_id: 'tab1', pinned: ['source'] }, ctx);

    const staged = (await staging.read())!;
    const before = nodeByKey(FIXTURE_FLOWS, 'source');
    const after = nodeByKey(staged.flows, 'source');
    expect(after['x']).toBe(before['x']);
    expect(after['y']).toBe(before['y']);
  });

  it('stages a layout-only diff and preserves _authoringKey identity', async () => {
    await layoutFlowTool.handler(
      { tab_id: 'tab1', lane_hints: { status: 'indicate' }, section_order: ['processing'] },
      ctx,
    );

    const staged = (await staging.read())!;
    const diff = diffFlows(FIXTURE_FLOWS, staged.flows);
    expect(diff.added.nodes).toEqual([]);
    expect(diff.removed.nodes).toEqual([]);
    expect(diff.added.wires).toEqual([]);
    expect(diff.removed.wires).toEqual([]);
    for (const modification of diff.modified.nodes) {
      expect(modification.fields.every((field) => ['x', 'y', 'w', 'h'].includes(field))).toBe(true);
    }
    expect(stripLayoutGeometry(staged.flows)).toEqual(stripLayoutGeometry(FIXTURE_FLOWS));
    expect(authoringKeysById(staged.flows)).toEqual(authoringKeysById(FIXTURE_FLOWS));
  });

  it('respects the single staging slot', async () => {
    const first = await layoutFlowTool.handler({ tab_id: 'tab1' }, ctx);

    const err = await layoutFlowTool
      .handler({ tab_id: 'tab1' }, ctx)
      .catch((error: unknown) => error);

    expect(err).toBeInstanceOf(ToolBlockedError);
    expect((await staging.read())?.stagedHash).toBe(first.staged_hash);
  });

  it('accepts Node-RED ids for pinned keys', async () => {
    const group = FIXTURE_FLOWS.find(isGroup);
    if (group === undefined) throw new Error('fixture group missing');

    await layoutFlowTool.handler({ tab_id: 'tab1', pinned: [group.id] }, ctx);

    const staged = (await staging.read())!;
    const before = nodeByKey(FIXTURE_FLOWS, 'processing');
    const after = nodeByKey(staged.flows, 'processing');
    expect(after['x']).toBe(before['x']);
    expect(after['y']).toBe(before['y']);
    expect(after['w']).toBe(before['w']);
    expect(after['h']).toBe(before['h']);
  });
});
