/**
 * REND-5 — render_flow_png end-to-end (tool-coverage) + the buildContent
 * plumbing over the REAL stdio transport.
 *
 * Rig suite: the tool against the live Docker Node-RED (runtime + staged
 * renders, RENDER_DIR default output, health_check.rasterizer_available).
 *
 * Transport suite (pattern from tool-error-transport.test.ts): spawns the
 * actual server binary over stdio and pins
 *   1. default content = ONE pretty-JSON text block (byte-identity with the
 *      legacy wire format — the REND-5 stdio change is additive), and
 *   2. return_image: true appends an image/png block whose base64 decodes
 *      to the bytes at png_path.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_TAB_ID } from './global-setup.js';
import { buildIntegrationRig, callTool, type TestRig } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface RenderPngResult {
  rev: string | null;
  tab_id: string;
  against: 'staged' | 'runtime';
  staged_hash: string | null;
  based_on_snapshot_hash: string | null;
  png_path: string;
  width_px: number;
  height_px: number;
  geometry?: Array<{ id: string }>;
}

describe('render_flow_png e2e (rig)', () => {
  let rig: TestRig;

  beforeAll(async () => {
    rig = await buildIntegrationRig();
  });

  beforeEach(async () => {
    const baseUrl = rig.container.config.NODE_RED_BASE_URL!;
    const fixturePath = new URL('../fixtures/inject-to-debug.flows.json', import.meta.url);
    const raw = await readFile(fixturePath, 'utf8');
    const res = await fetch(`${baseUrl}/flows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Node-RED-Deployment-Type': 'full' },
      body: raw,
    });
    if (!res.ok) throw new Error(`seed failed: ${res.status}`);
    await rig.container.staging.clear();
  });

  afterAll(async () => {
    await rig.cleanup();
  });

  it('renders the runtime tab to a PNG file under RENDER_DIR', async () => {
    const out = (await callTool(rig.registry, rig.container, 'render_flow_png', {
      tab_id: FIXTURE_TAB_ID,
    })) as RenderPngResult;
    expect(out.against).toBe('runtime');
    expect(out.staged_hash).toBeNull();
    expect(out.png_path.startsWith(rig.container.config.RENDER_DIR + path.sep)).toBe(true);
    const bytes = await readFile(out.png_path);
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(bytes.readUInt32BE(16)).toBe(out.width_px);
    expect(bytes.readUInt32BE(20)).toBe(out.height_px);
  });

  it('staged render carries the stage hash and differs from the runtime pixels', async () => {
    const runtime = (await callTool(rig.registry, rig.container, 'render_flow_png', {
      tab_id: FIXTURE_TAB_ID,
    })) as RenderPngResult;

    const staged = (await callTool(rig.registry, rig.container, 'add_node', {
      tab_id: FIXTURE_TAB_ID,
      type: 'debug',
      opts: { key: 'rend5-staged-probe', label: 'REND5 staged probe' },
    })) as { ok: boolean; staged_hash: string };
    expect(staged.ok).toBe(true);

    const out = (await callTool(rig.registry, rig.container, 'render_flow_png', {
      tab_id: FIXTURE_TAB_ID,
      against: 'staged',
      include_geometry: true,
    })) as RenderPngResult;
    expect(out.against).toBe('staged');
    expect(out.staged_hash).toBe(staged.staged_hash);
    expect(out.geometry).toBeDefined();
    expect(out.geometry!.length).toBeGreaterThan(0);

    const stagedBytes = await readFile(out.png_path);
    const runtimeBytes = await readFile(runtime.png_path);
    expect(stagedBytes.equals(runtimeBytes)).toBe(false);
  });

  it('health_check reports rasterizer_available: true', async () => {
    const out = (await callTool(rig.registry, rig.container, 'health_check', {})) as {
      rasterizer_available: boolean;
    };
    expect(out.rasterizer_available).toBe(true);
  });
});

describe('render_flow_png over the real stdio transport (buildContent plumbing)', () => {
  let tmpRoot: string;
  let client: Client;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'nrmcp-rend5-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'bin/flow-otter.ts'],
      cwd: ROOT,
      env: {
        ...(process.env['PATH'] !== undefined ? { PATH: process.env['PATH'] } : {}),
        ...(process.env['HOME'] !== undefined ? { HOME: process.env['HOME'] } : {}),
        NODE_RED_BASE_URL: process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880',
        FLOW_SOURCE: 'admin-api',
        SNAPSHOT_DIR: path.join(tmpRoot, 'snapshots'),
        STAGING_DIR: path.join(tmpRoot, 'staging'),
        AUDIT_LOG_PATH: path.join(tmpRoot, 'audit.jsonl'),
        RENDER_DIR: path.join(tmpRoot, 'renders'),
        LOG_LEVEL: 'warn',
        // Unique env name so persisted-target rehydration finds no
        // ~/.flow-otter/<env>/target.json and is skipped.
        ENVIRONMENT_NAME: 'integration-rend5-transport',
        ACTOR_NAME: 'integration-test',
      },
    });
    client = new Client({ name: 'rend5-transport-test', version: '0.0.0' });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('default path: exactly one pretty-JSON text block (legacy byte-identity)', async () => {
    const result = await client.callTool({
      name: 'render_flow_png',
      arguments: { tab_id: FIXTURE_TAB_ID },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');
    const parsed = JSON.parse(content[0]!.text!) as RenderPngResult;
    expect(content[0]!.text).toBe(JSON.stringify(parsed, null, 2));
    expect(parsed.tab_id).toBe(FIXTURE_TAB_ID);
    const bytes = await readFile(parsed.png_path);
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it('return_image: true appends an inline image/png block matching png_path', async () => {
    const result = await client.callTool({
      name: 'render_flow_png',
      arguments: { tab_id: FIXTURE_TAB_ID, return_image: true },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    expect(content).toHaveLength(2);
    expect(content[0]!.type).toBe('text');
    expect(content[1]!.type).toBe('image');
    expect(content[1]!.mimeType).toBe('image/png');
    const parsed = JSON.parse(content[0]!.text!) as RenderPngResult;
    const fileBytes = await readFile(parsed.png_path);
    expect(Buffer.from(content[1]!.data!, 'base64').equals(fileBytes)).toBe(true);
  });

  it('a non-buildContent tool still emits the legacy single text block', async () => {
    const result = await client.callTool({ name: 'health_check', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');
    const parsed = JSON.parse(content[0]!.text!) as { rasterizer_available: boolean };
    expect(content[0]!.text).toBe(JSON.stringify(parsed, null, 2));
    expect(parsed.rasterizer_available).toBe(true);
  });
});
