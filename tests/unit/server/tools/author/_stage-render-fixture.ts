/**
 * Shared fixture for the REND-8 stage-render enrichment suites
 * (stage-render-hash-invariance / stage-render-enrichment /
 * stage-render-failure-injection / stage-render-rasterizer-absent).
 *
 * The runtime fixture is a compile fixed point (decompile→compile is
 * byte-identical only for compiler-shaped flows) so staged hashes are
 * deterministic across processes — that determinism is what lets the
 * invariance suite pin LITERAL hashes captured at pre-REND-8 HEAD and
 * assert byte-identity with/without render enrichment.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { canonicalHash } from '../../../../../src/shared/hash.js';
import { createLogger } from '../../../../../src/shared/logger.js';
import { compile } from '../../../../../src/toolkit/authoring/compile.js';
import type { AuthoringSpec } from '../../../../../src/toolkit/authoring/types.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../../src/toolkit/staging/staged-store.js';

export const SPEC: AuthoringSpec = {
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

export const FIXTURE_FLOWS = compile(SPEC).flows;
export const FIXTURE_HASH = canonicalHash(FIXTURE_FLOWS);

/** The canonical pinned op: a deterministic add_comment against the fixture. */
export const PIN_COMMENT_INPUT = {
  tab_id: 'tab1',
  text: 'render enrichment pin',
  position: { x: 120, y: 60 },
};

/**
 * LITERAL hashes captured at pre-REND-8 HEAD (commit a8fa390, REND-5) for
 * `PIN_COMMENT_INPUT` staged against `FIXTURE_FLOWS` with the fixed clock /
 * actor / agent_id below. REND-8's enrichment is output-only, so these MUST
 * never move: `PINNED_STAGED_HASH` is the canonical hash of the staged flows
 * and `PINNED_STAGED_RECORD_HASH` is the canonical hash of the ENTIRE
 * staged.json record — together they pin staged-byte identity with/without
 * render enrichment (and with enrichment failing at runtime).
 */
export const PINNED_STAGED_HASH =
  '04d98e9edc84f00546ca200eff9c3837f9804c490796ae8fb130b2d3718149d5';
export const PINNED_STAGED_RECORD_HASH =
  '7cc8389dbdb6bff06f20ce4a9ad2c0239d4fcb308056e218a5a4efa780dcc328';

export interface RenderCtxHarness {
  ctx: ToolContext;
  staging: StagedStore;
  renderDir: string;
  cleanup: () => Promise<void>;
}

export async function buildRenderCtx(
  fixtureFlows: unknown = FIXTURE_FLOWS,
): Promise<RenderCtxHarness> {
  const root = await mkdtemp(path.join(tmpdir(), 'stage-render-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(fixtureFlows), 'utf8');
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
  const staging = new StagedStore({ dir: config.STAGING_DIR });
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
  return {
    ctx: { ...containerFields, enrichAudit: () => undefined, container: containerFields },
    staging,
    renderDir: config.RENDER_DIR,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}
