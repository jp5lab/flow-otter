/**
 * Regression test for the secrets-redaction guarantee.
 *
 * Plants Bearer tokens, JWT-shaped strings, and long hex blobs in the various
 * `AuditEvent` fields that could leak them (error message, flow_source target,
 * actor, etc.) — then writes the event through `JsonlAuditLogger` and reads
 * the file back. Asserts the persisted line contains no recognizable secrets.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlAuditLogger } from '../../../../src/server/audit/jsonl.js';
import type { AuditEvent } from '../../../../src/server/audit/schema.js';
import { createLogger } from '../../../../src/shared/logger.js';

const BEARER = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.signature';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature123456789';
const LONG_HEX = 'a'.repeat(64);

let tmpRoot: string;
let logPath: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'redact-reg-'));
  logPath = path.join(tmpRoot, 'audit.jsonl');
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function leaksAnySecret(persisted: string): boolean {
  if (/Bearer\s+[A-Za-z0-9._-]{16,}/.test(persisted)) return true;
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(persisted)) return true;
  // 32+ hex blob (matches the redactor's SECRET_VALUE_PATTERNS heuristic).
  if (/[A-Fa-f0-9]{32,}/.test(persisted)) return true;
  return false;
}

async function readPersisted(): Promise<string> {
  return readFile(logPath, 'utf8');
}

describe('audit redaction regression', () => {
  it('Bearer token in error message is redacted', async () => {
    const logger = new JsonlAuditLogger({
      path: logPath,
      logger: createLogger({ level: 'silent' }),
    });
    const event: AuditEvent = {
      ts: '2026-05-10T00:00:00.000Z',
      actor: 'test',
      tool: 'get_flows',
      tier: 'read',
      args_hash: 'h',
      result: 'error',
      error: `request failed: ${BEARER}`,
      flow_source: 'http://localhost:1880',
      environment: 'unit',
      server_version: '0.0.0-test',
    };
    await logger.record(event);
    const raw = await readPersisted();
    expect(leaksAnySecret(raw)).toBe(false);
    expect(raw).toContain('***REDACTED***');
  });

  it('JWT-shaped value in flow_source is redacted', async () => {
    const logger = new JsonlAuditLogger({
      path: logPath,
      logger: createLogger({ level: 'silent' }),
    });
    const event: AuditEvent = {
      ts: '2026-05-10T00:00:00.000Z',
      actor: 'test',
      tool: 'health_check',
      tier: 'read',
      args_hash: 'h',
      result: 'success',
      // The redactor uses regex on values, so a JWT-shaped string anywhere
      // in a leaf string field gets caught.
      flow_source: JWT,
      environment: 'unit',
      server_version: '0.0.0-test',
    };
    await logger.record(event);
    const raw = await readPersisted();
    expect(leaksAnySecret(raw)).toBe(false);
  });

  it('long hex blob in actor field is redacted', async () => {
    const logger = new JsonlAuditLogger({
      path: logPath,
      logger: createLogger({ level: 'silent' }),
    });
    const event: AuditEvent = {
      ts: '2026-05-10T00:00:00.000Z',
      // Actor accidentally carries an API key (e.g. via a misconfigured CI runner).
      actor: LONG_HEX,
      tool: 'health_check',
      tier: 'read',
      args_hash: 'h',
      result: 'success',
      environment: 'unit',
      server_version: '0.0.0-test',
    };
    await logger.record(event);
    const raw = await readPersisted();
    expect(leaksAnySecret(raw)).toBe(false);
  });

  it('args_hash field stays clear (intentional pass-through)', async () => {
    // args_hash is in the ALLOW_AS_KEYS allowlist — even though its value
    // looks like a long hex blob, the redactor must preserve it so audit
    // forensics can hash-match argument blocks.
    const logger = new JsonlAuditLogger({
      path: logPath,
      logger: createLogger({ level: 'silent' }),
    });
    const event: AuditEvent = {
      ts: '2026-05-10T00:00:00.000Z',
      actor: 'test',
      tool: 'health_check',
      tier: 'read',
      args_hash: LONG_HEX,
      result: 'success',
      environment: 'unit',
      server_version: '0.0.0-test',
    };
    await logger.record(event);
    const raw = await readPersisted();
    expect(raw).toContain(LONG_HEX);
  });
});
