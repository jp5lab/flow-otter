import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import { buildRegistry } from '../../../../../src/server/tools/register.js';
import { ALL_TOOLS } from '../../../../../src/server/index.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { stageSpecTool } from '../../../../../src/server/tools/author/stage-spec.js';
import { validateSpecTool } from '../../../../../src/server/tools/author/validate-spec.js';
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
          key: 'target',
          type: 'debug',
          label: 'Target',
          position: { x: 260, y: 100 },
        },
      ],
      connections: [{ fromKey: 'source', outputPort: 0, toKey: 'target' }],
      groups: [],
      comments: [],
      junctions: [],
    },
  ],
};

const FIXTURE_FLOWS = compile(SPEC).flows;

type StageSpecInput = Parameters<typeof stageSpecTool.handler>[0];
type ValidateSpecInput = Parameters<typeof validateSpecTool.handler>[0];

const BASE_SPEC: ValidateSpecInput['spec'] = {
  tabs: [
    {
      id: 'tab1',
      label: 'Main',
      nodes: [
        { key: 'source', type: 'inject', label: 'Source' },
        { key: 'target', type: 'debug', label: 'Target' },
        { key: 'extra', type: 'debug', label: 'Extra' },
      ],
      connections: [
        { fromKey: 'source', outputPort: 0, toKey: 'target' },
        { fromKey: 'source', outputPort: 0, toKey: 'extra' },
      ],
      groups: [],
      comments: [],
      junctions: [],
    },
  ],
};

let ctx: ToolContext;
let staging: StagedStore;
let cleanup: () => Promise<void>;
let flowsPath: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'validate-spec-'));
  flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(FIXTURE_FLOWS), 'utf8');
  ctx = makeCtx({
    READ_ONLY_MODE: 'false',
    ENABLE_WRITE_TOOLS: 'true',
  });
  cleanup = async () => rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await cleanup();
});

function makeCtx(extraEnv: Record<string, string>): ToolContext {
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
    ...extraEnv,
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
  return { ...containerFields, enrichAudit: () => undefined, container: containerFields };
}

async function stage(input: StageSpecInput) {
  return stageSpecTool.handler(input, ctx);
}

describe('validate_spec', () => {
  it('rejects raw geometry with the same computed-placement schema error', () => {
    const parsed = validateSpecTool.inputZod.safeParse({
      spec: {
        tabs: [
          {
            id: 'tab1',
            label: 'Main',
            nodes: [{ key: 'bad', type: 'debug', position: { x: 1, y: 1 } }],
            connections: [],
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success === false ? parsed.error.message : '').toContain(
      'FlowOtter computes placement',
    );
  });

  it('returns diagnostics and diff data without writing or blocking on a pending stage', async () => {
    const first = await stage({
      spec: {
        tabs: [
          {
            id: 'tab1',
            label: 'Main',
            nodes: [
              { key: 'source', type: 'inject', label: 'Source' },
              { key: 'target', type: 'debug', label: 'Target' },
              { key: 'pending', type: 'debug', label: 'Pending' },
            ],
            connections: [
              { fromKey: 'source', outputPort: 0, toKey: 'target' },
              { fromKey: 'source', outputPort: 0, toKey: 'pending' },
            ],
            groups: [],
            comments: [],
            junctions: [],
          },
        ],
      },
    });

    const out = await validateSpecTool.handler({ spec: BASE_SPEC }, ctx);

    expect(out.ok).toBe(true);
    expect(out.staged).toBe(false);
    expect(out.would_stage_hash).toBeTruthy();
    expect(out.diff_summary.nodes_added).toBeGreaterThan(0);
    expect(out.layout_report.engine).toBe('two_level');
    expect((await staging.read())?.stagedHash).toBe(first.staged_hash);
  });

  it('returns validation errors as diagnostics instead of staging or throwing', async () => {
    const out = await validateSpecTool.handler(
      {
        spec: {
          tabs: [
            {
              id: 'tab1',
              label: 'Main',
              nodes: [
                { key: 'source', type: 'inject', label: 'Source' },
                {
                  key: 'bad-function',
                  type: 'function',
                  label: 'Bad Function',
                  passthrough: { func: 'if (', outputs: 1 },
                },
              ],
              connections: [{ fromKey: 'source', outputPort: 0, toKey: 'bad-function' }],
              groups: [],
              comments: [],
              junctions: [],
            },
          ],
        },
      },
      ctx,
    );

    expect(out.ok).toBe(true);
    expect(out.has_errors).toBe(true);
    expect(out.errors).toBeGreaterThan(0);
    expect(out.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(out.diff_summary.nodes_added).toBeGreaterThan(0);
    expect(await staging.read()).toBeNull();
  });

  it('is visible in READ_ONLY_MODE while stage_spec is not', async () => {
    ctx = makeCtx({
      READ_ONLY_MODE: 'true',
      ENABLE_WRITE_TOOLS: 'false',
    });
    const registry = buildRegistry(ctx.container, ALL_TOOLS);
    registry.enableToolset('spec_authoring');

    expect(registry.find('validate_spec')).toBeDefined();
    expect(registry.find('stage_spec')).toBeUndefined();

    const out = await validateSpecTool.handler({ spec: BASE_SPEC }, ctx);
    expect(out.ok).toBe(true);
    expect(await staging.read()).toBeNull();
  });
});
