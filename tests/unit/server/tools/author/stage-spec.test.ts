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
import { stageSpecTool } from '../../../../../src/server/tools/author/stage-spec.js';
import { isTab, type FlowsJson } from '../../../../../src/shared/flows-json.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { isOnGrid } from '../../../../../src/toolkit/layout/grid.js';
import { rectsDisjoint, tabLayoutObjects } from '../../../../../src/toolkit/layout/index.js';
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
          key: 'removed-by-omission',
          type: 'debug',
          label: 'Removed',
          position: { x: 420, y: 100 },
        },
      ],
      connections: [{ fromKey: 'source', outputPort: 0, toKey: 'worker' }],
      groups: [],
      comments: [],
      junctions: [],
    },
    {
      id: 'untouched',
      label: 'Untouched',
      nodes: [
        {
          key: 'untouched-node',
          type: 'debug',
          label: 'Untouched',
          position: { x: 160, y: 220 },
        },
      ],
      connections: [],
      groups: [],
      comments: [],
      junctions: [],
    },
  ],
};

const FIXTURE_FLOWS = compile(SPEC).flows;

type StageSpecInput = Parameters<typeof stageSpecTool.handler>[0];

const BASE_DECLARED_TAB: StageSpecInput['spec']['tabs'][number] = {
  id: 'tab1',
  label: 'Main',
  nodes: [
    { key: 'source', type: 'inject', label: 'Source' },
    {
      key: 'worker',
      type: 'function',
      label: 'Worker',
      passthrough: { func: 'return msg;', outputs: 1 },
    },
  ],
  connections: [{ fromKey: 'source', outputPort: 0, toKey: 'worker' }],
  groups: [],
  comments: [],
  junctions: [],
};

let ctx: ToolContext;
let staging: StagedStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-spec-'));
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
    ENABLE_WRITE_TOOLS: 'true',
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

async function stage(input: StageSpecInput) {
  return stageSpecTool.handler(input, ctx);
}

function nodeByKey(flows: FlowsJson, key: string): Record<string, unknown> {
  const found = flows.find((node) => (node as Record<string, unknown>)['_authoringKey'] === key);
  if (found === undefined) throw new Error(`missing key ${key}`);
  return found;
}

function tabIdByKey(flows: FlowsJson, key: string): string {
  const tab = flows.find((node) => isTab(node) && node._authoringKey === key);
  if (tab === undefined) throw new Error(`missing tab ${key}`);
  return tab.id;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected JSON schema object');
  }
  return value as Record<string, unknown>;
}

describe('stage_spec', () => {
  it('rejects raw node geometry with a computed-placement error', () => {
    const parsed = stageSpecTool.inputZod.safeParse({
      spec: {
        tabs: [
          {
            ...BASE_DECLARED_TAB,
            nodes: [{ key: 'bad', type: 'debug', x: 100 }],
            connections: [],
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success === false ? parsed.error.message : '').toContain(
      'FlowOtter computes placement',
    );
    const schema = asRecord(stageSpecTool.inputJsonSchema);
    const properties = asRecord(schema['properties']);
    const spec = asRecord(properties['spec']);
    const specProperties = asRecord(spec['properties']);
    const tabs = asRecord(specProperties['tabs']);
    const tabItems = asRecord(tabs['items']);
    const tabProperties = asRecord(tabItems['properties']);
    const nodes = asRecord(tabProperties['nodes']);
    const nodeSchema = asRecord(nodes['items']);
    const nodeProperties = asRecord(nodeSchema['properties']);
    const xProperty = asRecord(nodeProperties['x']);
    expect(nodeSchema['additionalProperties']).toBe(false);
    expect(xProperty['description']).toContain('FlowOtter computes placement');
  });

  it('preserves existing ids and pinned positions while computing new node placement', async () => {
    const out = await stage({
      spec: {
        tabs: [
          {
            ...BASE_DECLARED_TAB,
            nodes: [
              ...BASE_DECLARED_TAB.nodes,
              { key: 'new-debug', type: 'debug', label: 'New Debug' },
            ],
            connections: [
              ...BASE_DECLARED_TAB.connections,
              { fromKey: 'worker', outputPort: 0, toKey: 'new-debug' },
            ],
          },
        ],
      },
      layout_hints: { lane_hints: { 'new-debug': 'main' } },
    });

    expect(out.ok).toBe(true);
    expect(out.layout_report.tabs[0]?.pinned).toEqual(['source', 'worker']);
    const staged = (await staging.read())!;
    const priorSource = nodeByKey(FIXTURE_FLOWS, 'source');
    const stagedSource = nodeByKey(staged.flows, 'source');
    const newDebug = nodeByKey(staged.flows, 'new-debug');
    expect(stagedSource.id).toBe(priorSource.id);
    expect(stagedSource.x).toBe(priorSource.x);
    expect(stagedSource.y).toBe(priorSource.y);
    expect(isOnGrid({ x: newDebug.x as number, y: newDebug.y as number })).toBe(true);

    const tabId = tabIdByKey(staged.flows, 'tab1');
    const objects = tabLayoutObjects(staged.flows, tabId);
    const workerBox = objects.get(nodeByKey(staged.flows, 'worker').id as string)?.box;
    const newBox = objects.get(newDebug.id as string)?.box;
    if (workerBox === undefined || newBox === undefined) throw new Error('missing layout boxes');
    expect(rectsDisjoint(workerBox, newBox)).toBe(true);
  });

  it('replaces declared tabs by omission while preserving undeclared tabs', async () => {
    await stage({
      spec: {
        tabs: [BASE_DECLARED_TAB],
      },
    });

    const staged = (await staging.read())!;
    expect(nodeByKey(staged.flows, 'source')).toBeDefined();
    expect(
      staged.flows.some(
        (node) => (node as Record<string, unknown>)['_authoringKey'] === 'removed-by-omission',
      ),
    ).toBe(false);
    expect(nodeByKey(staged.flows, 'untouched-node')).toBeDefined();
  });

  it('dry_run validates and diffs without writing the staging slot', async () => {
    const out = await stage({
      dry_run: true,
      spec: {
        tabs: [
          {
            ...BASE_DECLARED_TAB,
            nodes: [...BASE_DECLARED_TAB.nodes, { key: 'dry-node', type: 'debug' }],
          },
        ],
      },
    });

    expect(out.ok).toBe(true);
    expect(out.dry_run).toBe(true);
    expect(out.staged).toBe(false);
    expect(out.diff_summary.nodes_added).toBeGreaterThan(0);
    expect(await staging.read()).toBeNull();
  });

  it('refuses no-op specs outside dry_run', async () => {
    await expect(
      stage({
        spec: {
          tabs: [
            {
              id: 'tab1',
              label: 'Main',
              nodes: [
                { key: 'source', type: 'inject', label: 'Source' },
                {
                  key: 'worker',
                  type: 'function',
                  label: 'Worker',
                  passthrough: { func: 'return msg;', outputs: 1 },
                },
                { key: 'removed-by-omission', type: 'debug', label: 'Removed' },
              ],
              connections: [{ fromKey: 'source', outputPort: 0, toKey: 'worker' }],
              groups: [],
              comments: [],
              junctions: [],
            },
            {
              id: 'untouched',
              label: 'Untouched',
              nodes: [{ key: 'untouched-node', type: 'debug', label: 'Untouched' }],
              connections: [],
              groups: [],
              comments: [],
              junctions: [],
            },
          ],
        },
      }),
    ).rejects.toThrow(/produced no change/);
    expect(await staging.read()).toBeNull();
  });

  it('matches stage_changes pending-stage, amend_of, and force_takeover semantics', async () => {
    const first = await stage({
      spec: {
        tabs: [
          {
            ...BASE_DECLARED_TAB,
            nodes: [...BASE_DECLARED_TAB.nodes, { key: 'first', type: 'debug' }],
          },
        ],
      },
    });

    await expect(
      stage({
        spec: {
          tabs: [
            {
              ...BASE_DECLARED_TAB,
              nodes: [...BASE_DECLARED_TAB.nodes, { key: 'blocked', type: 'debug' }],
            },
          ],
        },
      }),
    ).rejects.toThrow(/pending deploy.*discard_staged_change/s);

    const amended = await stage({
      amend_of: first.staged_hash,
      spec: {
        tabs: [
          {
            ...BASE_DECLARED_TAB,
            nodes: [...BASE_DECLARED_TAB.nodes, { key: 'amended', type: 'debug' }],
          },
        ],
      },
    });
    expect(amended.amended).toBe(true);
    expect((await staging.read())?.stagedHash).toBe(amended.staged_hash);

    await staging.write({ ...(await staging.read())!, agent_id: 'pid-OTHER' });
    const err = await stage({
      amend_of: amended.staged_hash,
      spec: {
        tabs: [
          {
            ...BASE_DECLARED_TAB,
            nodes: [...BASE_DECLARED_TAB.nodes, { key: 'foreign-blocked', type: 'debug' }],
          },
        ],
      },
    }).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(ToolBlockedError);
    expect((err as Error).message).toMatch(/force_takeover/);

    const takeover = await stage({
      amend_of: amended.staged_hash,
      force_takeover: true,
      spec: {
        tabs: [
          {
            ...BASE_DECLARED_TAB,
            nodes: [...BASE_DECLARED_TAB.nodes, { key: 'takeover', type: 'debug' }],
          },
        ],
      },
    });
    expect(takeover.amended).toBe(true);
    expect((await staging.read())?.agent_id).toBe('pid-test');
  });

  it('reports unknown layout hint keys as validation failures', async () => {
    const err = await stage({
      spec: { tabs: [BASE_DECLARED_TAB] },
      layout_hints: { lane_hints: { missing: 'main' } },
    }).catch((error: unknown) => error);

    expect(err).toBeInstanceOf(ValidationFailedError);
    expect((err as Error).message).toContain('missing');
  });
});
