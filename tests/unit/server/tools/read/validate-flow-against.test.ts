import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import { ValidationFailedError, type ToolContext } from '../../../../../src/server/tools/_tool.js';
import { validateAllFlowsTool } from '../../../../../src/server/tools/read/validate-all-flows.js';
import { validateFlowTool } from '../../../../../src/server/tools/read/validate-flow.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore, type StagedChange } from '../../../../../src/toolkit/staging/staged-store.js';

const RUNTIME_FLOWS = [
  { id: 'runtime-tab-id', type: 'tab', label: 'Runtime', disabled: false, info: '' },
  {
    id: 'runtime-inj',
    type: 'inject',
    z: 'runtime-tab-id',
    x: 100,
    y: 100,
    wires: [['runtime-debug']],
    name: 'Runtime Tick',
    props: [],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '',
    payloadType: 'date',
  },
  {
    id: 'runtime-debug',
    type: 'debug',
    z: 'runtime-tab-id',
    x: 300,
    y: 100,
    wires: [],
    name: 'Runtime Out',
  },
];

const STAGED_ONLY_TAB_ID = 'materialized-staged-tab-id';
const STAGED_ONLY_TAB_KEY = 'staged-tab-key';

const STAGED_FLOWS = [
  ...RUNTIME_FLOWS,
  {
    id: STAGED_ONLY_TAB_ID,
    type: 'tab',
    label: 'Staged Only',
    disabled: false,
    info: '',
    _authoringKey: STAGED_ONLY_TAB_KEY,
  },
  {
    id: 'staged-inj',
    type: 'inject',
    z: STAGED_ONLY_TAB_ID,
    x: 100,
    y: 100,
    wires: [['staged-debug']],
    name: 'Staged Tick',
    props: [],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '',
    payloadType: 'date',
    _authoringKey: 'staged-inj-key',
  },
  {
    id: 'staged-debug',
    type: 'debug',
    z: STAGED_ONLY_TAB_ID,
    x: 300,
    y: 100,
    wires: [],
    name: 'Staged Out',
    _authoringKey: 'staged-debug-key',
  },
];

const STAGED_CHANGE: StagedChange = {
  flows: STAGED_FLOWS,
  basedOnSnapshotHash: 'snap-hash-abc',
  basedOnRev: 'rev-123',
  stagedHash: 'staged-hash-def',
  stagedAt: '2026-07-06T00:00:00.000Z',
  actor: 'unit-test',
  agent_id: 'pid-test',
  reason: 'stage a whole flow',
};

let ctx: ToolContext;
let root: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'validate-against-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(RUNTIME_FLOWS), 'utf8');

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
  const containerFields = {
    config,
    flowSource: new FileFlowSource({ path: flowsPath }),
    snapshots: new FilesystemSnapshotStore({ rootDir: config.SNAPSHOT_DIR }),
    staging: new StagedStore({ dir: config.STAGING_DIR }),
    audit: new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger }),
    auth: new NoAuth(),
    logger,
    clock: (): Date => new Date('2026-07-06T00:00:00.000Z'),
    serverVersion: '0.0.0-test',
    agentId: 'pid-test',
  };
  ctx = { ...containerFields, enrichAudit: () => undefined, container: containerFields };
  cleanup = async () => {
    await rm(root, { recursive: true, force: true });
  };
});

afterEach(async () => {
  await cleanup();
});

function stagedInput(tabId: string): Parameters<typeof validateFlowTool.handler>[0] & {
  against: 'staged';
} {
  return { tab_id: tabId, against: 'staged' };
}

describe('validate_flow against staged/runtime', () => {
  it('default back-compat: omitted against keeps the old response bytes', async () => {
    await ctx.staging.write(STAGED_CHANGE);

    const out = await validateFlowTool.handler({ tab_id: 'runtime-tab-id' }, ctx);
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({
        rev: out.rev,
        tab_id: out.tab_id,
        diagnostics: out.diagnostics,
        has_errors: out.has_errors,
        errors: out.errors,
        warnings: out.warnings,
        layout: out.layout,
      }),
    );
    expect('against' in out).toBe(false);
    expect('staged_hash' in out).toBe(false);
    expect('based_on_snapshot_hash' in out).toBe(false);
  });

  it('validates a staged-only tab by authoring key and materialized id', async () => {
    await ctx.staging.write(STAGED_CHANGE);

    const byKey = await validateFlowTool.handler(stagedInput(STAGED_ONLY_TAB_KEY), ctx);
    const byId = await validateFlowTool.handler(stagedInput(STAGED_ONLY_TAB_ID), ctx);

    expect(byKey.tab_id).toBe(STAGED_ONLY_TAB_ID);
    expect(byKey.against).toBe('staged');
    expect(byKey.rev).toBe('rev-123');
    expect(byKey.staged_hash).toBe('staged-hash-def');
    expect(byKey.based_on_snapshot_hash).toBe('snap-hash-abc');
    expect(byKey.has_errors).toBe(false);
    expect(byKey.layout.rules).toHaveLength(8);
    expect(byId).toEqual(byKey);
    expect(() => validateFlowTool.outputZod?.parse(byKey)).not.toThrow();
  });

  it("against:'staged' with an empty slot throws ValidationFailedError with diagnostics", async () => {
    let caught: unknown;
    try {
      await validateFlowTool.handler(stagedInput(STAGED_ONLY_TAB_KEY), ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationFailedError);
    const vfe = caught as ValidationFailedError;
    expect(vfe.message).toMatch(/No staged change to validate/);
    expect(vfe.diagnostics).toHaveLength(1);
    expect(vfe.diagnostics[0]).toMatchObject({
      severity: 'error',
      rule: 'staging/no-staged-change',
    });
  });

  it('validating staged state leaves the staging slot byte-identical', async () => {
    await ctx.staging.write(STAGED_CHANGE);
    const stagedPath = path.join(root, 'staging', 'staged.json');
    const before = await readFile(stagedPath, 'utf8');

    await validateFlowTool.handler(stagedInput(STAGED_ONLY_TAB_KEY), ctx);
    const afterFlow = await readFile(stagedPath, 'utf8');

    await validateAllFlowsTool.handler({ against: 'staged' }, ctx);

    const after = await readFile(stagedPath, 'utf8');
    expect(afterFlow).toBe(before);
    expect(after).toBe(before);
  });
});

describe('validate_all_flows against staged/runtime', () => {
  it('default back-compat: omitted against keeps the old response bytes', async () => {
    await ctx.staging.write(STAGED_CHANGE);

    const out = await validateAllFlowsTool.handler({}, ctx);
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({
        rev: out.rev,
        diagnostics: out.diagnostics,
        has_errors: out.has_errors,
        errors: out.errors,
        warnings: out.warnings,
        layout: out.layout,
      }),
    );
    expect('against' in out).toBe(false);
    expect('staged_hash' in out).toBe(false);
    expect('based_on_snapshot_hash' in out).toBe(false);
  });

  it('validates the staged full document with stage provenance', async () => {
    await ctx.staging.write(STAGED_CHANGE);

    const out = await validateAllFlowsTool.handler({ against: 'staged' }, ctx);

    expect(out.against).toBe('staged');
    expect(out.rev).toBe('rev-123');
    expect(out.staged_hash).toBe('staged-hash-def');
    expect(out.based_on_snapshot_hash).toBe('snap-hash-abc');
    expect(out.layout.rules).toHaveLength(8);
    expect(() => validateAllFlowsTool.outputZod?.parse(out)).not.toThrow();
  });
});
