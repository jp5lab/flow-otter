import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlAuditLogger } from '../../../../src/server/audit/jsonl.js';

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'audit-tail-'));
  logPath = path.join(dir, 'audit.jsonl');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonlAuditLogger.tail', () => {
  it('returns [] when file does not exist', async () => {
    const logger = new JsonlAuditLogger({ path: logPath });
    expect(await logger.tail(10)).toEqual([]);
  });

  it('returns [] for n <= 0', async () => {
    const logger = new JsonlAuditLogger({ path: logPath });
    await writeFile(logPath, '{"ts":"a"}\n{"ts":"b"}\n');
    expect(await logger.tail(0)).toEqual([]);
  });

  it('returns last N parsed lines', async () => {
    await writeFile(
      logPath,
      [
        JSON.stringify({ ts: '2026-01-01', tool: 'a' }),
        JSON.stringify({ ts: '2026-01-02', tool: 'b' }),
        JSON.stringify({ ts: '2026-01-03', tool: 'c' }),
        '',
      ].join('\n'),
    );
    const logger = new JsonlAuditLogger({ path: logPath });
    const out = await logger.tail(2);
    expect(out).toHaveLength(2);
    expect(out[0]?.parsed?.['tool']).toBe('b');
    expect(out[1]?.parsed?.['tool']).toBe('c');
  });

  it('returns all lines when N > file length', async () => {
    await writeFile(logPath, JSON.stringify({ ts: 't', tool: 'only' }) + '\n');
    const logger = new JsonlAuditLogger({ path: logPath });
    const out = await logger.tail(10);
    expect(out).toHaveLength(1);
  });

  it('preserves raw line bytes (no re-redaction)', async () => {
    const line = JSON.stringify({ ts: 't', tool: 'x', token: '***SET***' });
    await writeFile(logPath, line + '\n');
    const logger = new JsonlAuditLogger({ path: logPath });
    const out = await logger.tail(1);
    expect(out[0]?.raw).toBe(line);
  });

  it('marks unparseable lines without throwing', async () => {
    await writeFile(logPath, '{ not json\n');
    const logger = new JsonlAuditLogger({ path: logPath });
    const out = await logger.tail(1);
    expect(out[0]?.parseError).toBeDefined();
  });
});
