import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonlAuditLogger } from '../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../src/server/config/load.js';
import type { ToolContext } from '../../../../src/server/tools/_tool.js';
import { healthCheckTool } from '../../../../src/server/tools/read/health-check.js';
import { renderFlowPngTool } from '../../../../src/server/tools/read/render-flow-png.js';
import { FileFlowSource } from '../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../src/adapters/nodered/auth.js';
import {
  RasterizerUnavailableError,
  rasterizeSvg,
  rasterizerAvailable,
} from '../../../../src/toolkit/render/png.js';
import { FilesystemSnapshotStore } from '../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore } from '../../../../src/toolkit/staging/staged-store.js';
import { createLogger } from '../../../../src/shared/logger.js';

/**
 * REND-5 — RasterizerUnavailableError HARD-FAIL pin (no silent degradation).
 *
 * `@resvg/resvg-js` is an OPTIONAL dependency: npm may skip it (unsupported
 * platform, --omit=optional) and the native binding may fail to load. This
 * file mocks the module import to fail and pins that:
 *   - every rasterization entry point throws RasterizerUnavailableError
 *     with an install hint — the PNG tool NEVER substitutes SVG output;
 *   - no PNG file is written on the failure path;
 *   - health_check reports rasterizer_available: false (and still succeeds).
 */

vi.mock('@resvg/resvg-js', () => {
  throw new Error("Cannot find module '@resvg/resvg-js'");
});

const FLOWS = [
  { id: 'tab1', type: 'tab', label: 'Main', disabled: false, info: '' },
  { id: 'dbg1', type: 'debug', z: 'tab1', x: 300, y: 100, wires: [], name: 'Out' },
];

let ctx: ToolContext;
let root: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rend5-unavail-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(FLOWS), 'utf8');
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

describe('rasterizer unavailable (REND-5 hard-fail)', () => {
  it('rasterizeSvg throws RasterizerUnavailableError with an install hint', async () => {
    let caught: unknown;
    try {
      await rasterizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RasterizerUnavailableError);
    const e = caught as RasterizerUnavailableError;
    expect(e.name).toBe('RasterizerUnavailableError');
    expect(e.message).toContain('@resvg/resvg-js');
    expect(e.message).toContain('npm install @resvg/resvg-js');
  });

  it('rasterizerAvailable reports false', async () => {
    await expect(rasterizerAvailable()).resolves.toBe(false);
  });

  it('render_flow_png HARD-FAILS — no PNG written, no SVG substitution', async () => {
    const outPath = path.join(root, 'never-written.png');
    let caught: unknown;
    try {
      await renderFlowPngTool.handler({ tab_id: 'tab1', output_path: outPath }, ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RasterizerUnavailableError);
    expect((caught as Error).name).toBe('RasterizerUnavailableError');
    // Nothing was written: the failure is loud, not a degraded artifact.
    await expect(stat(outPath)).rejects.toThrow();
  });

  it('health_check still succeeds and reports rasterizer_available: false', async () => {
    const out = await healthCheckTool.handler({}, ctx);
    expect(out.ok).toBe(true);
    expect(out.rasterizer_available).toBe(false);
  });
});
