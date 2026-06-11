import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlAuditLogger } from '../../../../../src/server/audit/jsonl.js';
import { loadConfig } from '../../../../../src/server/config/load.js';
import { ValidationFailedError, type ToolContext } from '../../../../../src/server/tools/_tool.js';
import { renderFlowPngTool } from '../../../../../src/server/tools/read/render-flow-png.js';
import { FileFlowSource } from '../../../../../src/adapters/flowsource/file.js';
import { NoAuth } from '../../../../../src/adapters/nodered/auth.js';
import { renderGeometry } from '../../../../../src/toolkit/render/svg.js';
import { FilesystemSnapshotStore } from '../../../../../src/toolkit/snapshot/filesystem.js';
import { StagedStore, type StagedChange } from '../../../../../src/toolkit/staging/staged-store.js';
import { createLogger } from '../../../../../src/shared/logger.js';

/**
 * REND-5 — NEW tool render_flow_png (F1, D5, R3).
 *
 * Mirrors render_flow_svg's against: contract (REND-4) on the PNG channel
 * and pins the REND-5 additions: PNG file output (magic bytes, dimensions,
 * atomic write, RENDER_DIR default), scale, include_geometry byte-equality
 * with renderGeometry (frozen contract #1), output_path containment, and
 * the opt-in return_image content block via buildContent.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
let root: string;
let renderDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rend5-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, JSON.stringify(RUNTIME_FLOWS), 'utf8');
  renderDir = path.join(root, 'renders');

  const config = loadConfig({
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: flowsPath,
    SNAPSHOT_DIR: path.join(root, 'snapshots'),
    STAGING_DIR: path.join(root, 'staging'),
    AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
    RENDER_DIR: renderDir,
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

describe('render_flow_png (REND-5)', () => {
  it('writes a PNG (magic bytes + dimensions) under RENDER_DIR by default', async () => {
    const out = await renderFlowPngTool.handler({ tab_id: 'tab1' }, ctx);
    expect(out.against).toBe('runtime');
    expect(out.staged_hash).toBeNull();
    expect(out.based_on_snapshot_hash).toBeNull();
    expect(out.png_path.startsWith(renderDir + path.sep)).toBe(true);
    expect(out.png_path.endsWith('render-tab1-runtime.png')).toBe(true);
    const bytes = await readFile(out.png_path);
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    // IHDR dimensions agree with the reported width_px/height_px.
    expect(bytes.readUInt32BE(16)).toBe(out.width_px);
    expect(bytes.readUInt32BE(20)).toBe(out.height_px);
    expect(out.width_px).toBeGreaterThan(0);
    expect(out.height_px).toBeGreaterThan(0);
    expect(() => renderFlowPngTool.outputZod?.parse(out)).not.toThrow();
  });

  it('staged render carries stage provenance and different pixels from runtime', async () => {
    await ctx.staging.write(STAGED_CHANGE);

    const staged = await renderFlowPngTool.handler({ tab_id: 'tab1', against: 'staged' }, ctx);
    expect(staged.against).toBe('staged');
    expect(staged.staged_hash).toBe('staged-hash-def');
    expect(staged.based_on_snapshot_hash).toBe('snap-hash-abc');
    // rev = the runtime rev the stage was computed against (based_on_rev).
    expect(staged.rev).toBe('rev-123');

    const runtime = await renderFlowPngTool.handler({ tab_id: 'tab1', against: 'runtime' }, ctx);
    expect(runtime.staged_hash).toBeNull();
    expect(runtime.png_path).not.toBe(staged.png_path);

    const stagedBytes = await readFile(staged.png_path);
    const runtimeBytes = await readFile(runtime.png_path);
    // The staged-only node must be visible in the pixels.
    expect(stagedBytes.equals(runtimeBytes)).toBe(false);
  });

  it('default back-compat: omitted against renders the runtime, byte-identical PNG', async () => {
    await ctx.staging.write(STAGED_CHANGE);
    const implicit = await renderFlowPngTool.handler(
      { tab_id: 'tab1', output_path: path.join(root, 'implicit.png') },
      ctx,
    );
    const explicit = await renderFlowPngTool.handler(
      { tab_id: 'tab1', against: 'runtime', output_path: path.join(root, 'explicit.png') },
      ctx,
    );
    expect(implicit.against).toBe('runtime');
    expect(implicit.staged_hash).toBeNull();
    const a = await readFile(implicit.png_path);
    const b = await readFile(explicit.png_path);
    expect(a.equals(b)).toBe(true);
  });

  it("against:'staged' with an empty slot throws ValidationFailedError with diagnostics", async () => {
    let caught: unknown;
    try {
      await renderFlowPngTool.handler({ tab_id: 'tab1', against: 'staged' }, ctx);
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

  it('unknown tab on the staged path names the staged change in the error', async () => {
    await ctx.staging.write(STAGED_CHANGE);
    await expect(
      renderFlowPngTool.handler({ tab_id: 'no-such-tab', against: 'staged' }, ctx),
    ).rejects.toThrow(/Tab 'no-such-tab' not found in the staged change/);
  });

  it('scale multiplies the PNG dimensions', async () => {
    const base = await renderFlowPngTool.handler({ tab_id: 'tab1' }, ctx);
    const doubled = await renderFlowPngTool.handler(
      { tab_id: 'tab1', scale: 2, output_path: path.join(root, 'x2.png') },
      ctx,
    );
    expect(doubled.width_px).toBe(base.width_px * 2);
    expect(doubled.height_px).toBe(base.height_px * 2);
  });

  it('include_geometry emits the renderGeometry array byte-for-byte (frozen contract #1)', async () => {
    const out = await renderFlowPngTool.handler({ tab_id: 'tab1', include_geometry: true }, ctx);
    const expected = renderGeometry(RUNTIME_FLOWS, 'tab1');
    expect(out.geometry).toBeDefined();
    expect(JSON.stringify(out.geometry)).toBe(JSON.stringify(expected));
  });

  it('include_geometry on the staged path reflects the STAGED flows', async () => {
    await ctx.staging.write(STAGED_CHANGE);
    const out = await renderFlowPngTool.handler(
      { tab_id: 'tab1', against: 'staged', include_geometry: true },
      ctx,
    );
    const expected = renderGeometry(STAGED_FLOWS, 'tab1');
    expect(JSON.stringify(out.geometry)).toBe(JSON.stringify(expected));
    expect(out.geometry?.some((e) => e.id === 'echo1')).toBe(true);
  });

  it('geometry is absent by default (include_geometry defaults false)', async () => {
    const out = await renderFlowPngTool.handler({ tab_id: 'tab1' }, ctx);
    expect('geometry' in out).toBe(false);
  });

  it('output_path must be absolute', async () => {
    await expect(
      renderFlowPngTool.handler({ tab_id: 'tab1', output_path: 'relative/out.png' }, ctx),
    ).rejects.toThrow(/must be an absolute path/);
  });

  it('output_path outside home and tmp is refused', async () => {
    await expect(
      renderFlowPngTool.handler({ tab_id: 'tab1', output_path: '/etc/flow-otter-render.png' }, ctx),
    ).rejects.toThrow(/resolves outside/);
    await expect(stat('/etc/flow-otter-render.png')).rejects.toThrow();
  });

  it('successive renders to the same default path overwrite atomically (no .tmp left)', async () => {
    const first = await renderFlowPngTool.handler({ tab_id: 'tab1' }, ctx);
    const second = await renderFlowPngTool.handler({ tab_id: 'tab1' }, ctx);
    expect(second.png_path).toBe(first.png_path);
    const dir = await import('node:fs/promises').then((fs) => fs.readdir(renderDir));
    expect(dir.filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  describe('buildContent (return_image opt-in)', () => {
    it('without return_image: single text block, byte-identical to the default wire format', async () => {
      const out = await renderFlowPngTool.handler({ tab_id: 'tab1' }, ctx);
      const blocks = await renderFlowPngTool.buildContent!(out, { tab_id: 'tab1' });
      expect(blocks).toEqual([{ type: 'text', text: JSON.stringify(out, null, 2) }]);
    });

    it('with return_image: appends an image/png block whose base64 matches the file', async () => {
      const out = await renderFlowPngTool.handler({ tab_id: 'tab1' }, ctx);
      const blocks = await renderFlowPngTool.buildContent!(out, {
        tab_id: 'tab1',
        return_image: true,
      });
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({ type: 'text', text: JSON.stringify(out, null, 2) });
      const image = blocks[1]!;
      if (image.type !== 'image') throw new Error('expected image block');
      expect(image.mimeType).toBe('image/png');
      const fileBytes = await readFile(out.png_path);
      expect(Buffer.from(image.data, 'base64').equals(fileBytes)).toBe(true);
    });
  });
});
