import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import { ValidationFailedError, type ToolContext } from '../../../../../src/server/tools/_tool.js';
import { renderFlowSvgTool } from '../../../../../src/server/tools/read/render-flow-svg.js';
import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore, type StagedChange } from '../../../../../src/toolkit/staging/staged-store.js';
import { createLogger } from '../../../../../src/shared/logger.js';

/**
 * REND-4 — `against:'staged'|'runtime'` on render_flow_svg (F7).
 *
 * The audit's F7 finding: render_flow_svg always read the runtime, so the
 * prescribed pre-deploy visual review necessarily excluded the change under
 * review. These tests pin the staged-vs-runtime pair, the empty-slot
 * diagnostics error, and default back-compat.
 */

const RUNTIME_FLOWS = [
  { id: 'tab1', type: 'tab', label: 'Main', disabled: false, info: '' },
  {
    id: 'inj1',
    type: 'inject',
    z: 'tab1',
    x: 100,
    y: 100,
    wires: [['dbg1']],
    name: 'Tick',
    props: [],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '',
    payloadType: 'date',
  },
  { id: 'dbg1', type: 'debug', z: 'tab1', x: 300, y: 100, wires: [], name: 'Out' },
];

/** Runtime flows + one extra node that exists ONLY in the staged change. */
const STAGED_FLOWS = [
  ...RUNTIME_FLOWS,
  { id: 'echo1', type: 'debug', z: 'tab1', x: 300, y: 200, wires: [], name: 'StagedEcho' },
];

const STAGED_CHANGE: StagedChange = {
  flows: STAGED_FLOWS,
  basedOnSnapshotHash: 'snap-hash-abc',
  basedOnRev: 'rev-123',
  stagedHash: 'staged-hash-def',
  stagedAt: '2026-06-10T00:00:00.000Z',
  actor: 'unit-test',
  agent_id: 'pid-test',
  reason: 'add echo node',
};

let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rend4-'));
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
    clock: (): Date => new Date('2026-06-10T00:00:00.000Z'),
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

describe('render_flow_svg against (REND-4)', () => {
  it('staged render contains the staged node; runtime render does not', async () => {
    await ctx.staging.write(STAGED_CHANGE);

    const staged = await renderFlowSvgTool.handler({ tab_id: 'tab1', against: 'staged' }, ctx);
    expect(staged.svg).toContain('StagedEcho');
    expect(staged.against).toBe('staged');
    expect(staged.staged_hash).toBe('staged-hash-def');
    expect(staged.based_on_snapshot_hash).toBe('snap-hash-abc');
    // rev = the runtime rev the stage was computed against (based_on_rev).
    expect(staged.rev).toBe('rev-123');

    const runtime = await renderFlowSvgTool.handler({ tab_id: 'tab1', against: 'runtime' }, ctx);
    expect(runtime.svg).not.toContain('StagedEcho');
    expect(runtime.against).toBe('runtime');
    expect(runtime.staged_hash).toBeNull();
    expect(runtime.based_on_snapshot_hash).toBeNull();

    // Both shapes satisfy the declared output schema.
    expect(() => renderFlowSvgTool.outputZod?.parse(staged)).not.toThrow();
    expect(() => renderFlowSvgTool.outputZod?.parse(runtime)).not.toThrow();
  });

  it("against:'staged' with an empty slot throws ValidationFailedError with diagnostics", async () => {
    let caught: unknown;
    try {
      await renderFlowSvgTool.handler({ tab_id: 'tab1', against: 'staged' }, ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationFailedError);
    const vfe = caught as ValidationFailedError;
    expect(vfe.message).toMatch(/No staged change to render/);
    expect(vfe.diagnostics).toHaveLength(1);
    expect(vfe.diagnostics[0]).toMatchObject({
      severity: 'error',
      rule: 'staging/no-staged-change',
    });
  });

  it('default back-compat: omitted against renders the runtime, byte-identical to explicit runtime', async () => {
    await ctx.staging.write(STAGED_CHANGE);

    const implicit = await renderFlowSvgTool.handler({ tab_id: 'tab1' }, ctx);
    const explicit = await renderFlowSvgTool.handler({ tab_id: 'tab1', against: 'runtime' }, ctx);
    expect(implicit.against).toBe('runtime');
    expect(implicit.staged_hash).toBeNull();
    expect(implicit.based_on_snapshot_hash).toBeNull();
    expect(implicit.svg).toBe(explicit.svg);
    expect(implicit.rev).toBe(explicit.rev);
    expect(implicit.svg).not.toContain('StagedEcho');
  });

  it('unknown tab on the staged path names the staged change in the error', async () => {
    await ctx.staging.write(STAGED_CHANGE);
    await expect(
      renderFlowSvgTool.handler({ tab_id: 'no-such-tab', against: 'staged' }, ctx),
    ).rejects.toThrow(/Tab 'no-such-tab' not found in the staged change/);
  });
});
