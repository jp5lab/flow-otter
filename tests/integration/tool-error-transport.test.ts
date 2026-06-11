/**
 * WSB-1 (SD2) — structured error payloads through the REAL stdio transport.
 *
 * Regression pin for the 2026-06-10 audit e2 defect: a staging tool failed
 * with "add_node produced flows with 1 validation error(s)." and the
 * diagnostics were dropped at the transport — the agent saw the count but
 * never the cause. This suite spawns the actual server binary over stdio
 * (the same wire Claude Code uses) and asserts:
 *
 *   1. "validation error(s)" NEVER crosses the transport without its
 *      diagnostics (the e2 defect, dead forever), and
 *   2. the SUCCESS path is byte-identical to the legacy format — one text
 *      block of `JSON.stringify(result, null, 2)` (WSB-1 is error-path only).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FIXTURE_TAB_ID = '1111111111111111';

interface TextBlock {
  type: string;
  text: string;
}

function textBlocks(result: unknown): TextBlock[] {
  const content = (result as { content?: unknown }).content;
  expect(Array.isArray(content)).toBe(true);
  return content as TextBlock[];
}

describe('tool errors over the real stdio transport (WSB-1 / SD2)', () => {
  let tmpRoot: string;
  let client: Client;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'nrmcp-wsb1-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'bin/flow-otter.ts'],
      cwd: ROOT,
      env: {
        ...(process.env['PATH'] !== undefined ? { PATH: process.env['PATH'] } : {}),
        ...(process.env['HOME'] !== undefined ? { HOME: process.env['HOME'] } : {}),
        NODE_RED_BASE_URL: process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880',
        FLOW_SOURCE: 'admin-api',
        ENABLE_WRITE_TOOLS: 'true',
        READ_ONLY_MODE: 'false',
        SNAPSHOT_DIR: path.join(tmpRoot, 'snapshots'),
        STAGING_DIR: path.join(tmpRoot, 'staging'),
        AUDIT_LOG_PATH: path.join(tmpRoot, 'audit.jsonl'),
        LOG_LEVEL: 'warn',
        // Unique env name so persisted-target rehydration finds no
        // ~/.flow-otter/<env>/target.json and is skipped (read-only check).
        ENVIRONMENT_NAME: 'integration-wsb1-transport',
        ACTOR_NAME: 'integration-test',
      },
    });
    client = new Client({ name: 'wsb1-transport-test', version: '0.0.0' });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('e2 regression: "validation error(s)" never crosses the wire without its diagnostics', async () => {
    // Off-canvas position (x > CANVAS_MAX_X) is a deterministic
    // severity-error lint finding → ValidationFailedError at stage time.
    const result = await client.callTool({
      name: 'add_node',
      arguments: {
        tab_id: FIXTURE_TAB_ID,
        type: 'debug',
        opts: { key: 'wsb1-offcanvas-probe', position: { x: 99980, y: 100 } },
      },
    });

    expect(result.isError).toBe(true);
    const blocks = textBlocks(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
    const text = blocks[0]!.text;

    // Legacy human-readable first line, byte-compatible with pre-WSB-1.
    expect(text.split('\n')[0]).toMatch(
      /^Tool 'add_node' failed: add_node produced flows with \d+ validation error\(s\)\.$/,
    );

    // The cause now travels with the count: a parseable JSON block carrying
    // the diagnostics verbatim.
    const idx = text.indexOf('\n\n');
    expect(idx).toBeGreaterThan(0);
    const payload = JSON.parse(text.slice(idx + 2)) as {
      error: {
        name: string;
        message: string;
        diagnostics?: Array<{ rule?: string; message?: string; nodeId?: string }>;
      };
    };
    expect(payload.error.name).toBe('ValidationFailedError');
    expect(payload.error.message).toContain('validation error(s)');
    expect(payload.error.diagnostics).toBeDefined();
    expect(payload.error.diagnostics!.length).toBeGreaterThan(0);
    const offCanvas = payload.error.diagnostics!.find((d) => d.rule === 'off-canvas');
    expect(offCanvas).toBeDefined();
    expect(offCanvas!.message).toContain('off-canvas');
  });

  it('success path stays byte-identical: one text block of JSON.stringify(result, null, 2)', async () => {
    const result = await client.callTool({ name: 'list_flows', arguments: {} });

    expect(result.isError ?? false).toBe(false);
    const blocks = textBlocks(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
    const text = blocks[0]!.text;
    // Pin the exact legacy serialization: parseable JSON, pretty-printed at
    // 2 spaces, with no prose before or after.
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  });

  it('failed stage left the staging slot empty (error thrown before write)', async () => {
    const result = await client.callTool({ name: 'get_staged_change', arguments: {} });
    expect(result.isError ?? false).toBe(false);
    const blocks = textBlocks(result);
    const parsed = JSON.parse(blocks[0]!.text) as { staged?: unknown };
    expect(parsed.staged).toBeNull();
  });
});
