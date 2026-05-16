import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from '../../shared/logger.js';

import { redact } from './redact.js';
import type { AuditEvent } from './schema.js';

export interface AuditTailEntry {
  readonly raw: string;
  readonly parsed?: Readonly<Record<string, unknown>>;
  readonly parseError?: string;
}

export interface AuditLogger {
  record(event: AuditEvent): Promise<void>;
  tail(n: number): Promise<AuditTailEntry[]>;
}

export interface JsonlAuditLoggerOptions {
  path: string;
  redactor?: (event: unknown) => unknown;
  logger?: Logger;
}

export class JsonlAuditLogger implements AuditLogger {
  constructor(private readonly opts: JsonlAuditLoggerOptions) {}

  async tail(n: number): Promise<AuditTailEntry[]> {
    if (n <= 0) return [];
    let raw: string;
    try {
      raw = await readFile(this.opts.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const lines = raw.split('\n').filter((l) => l.length > 0);
    const slice = lines.slice(-n);
    return slice.map((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return { raw: line, parsed };
      } catch (err) {
        return { raw: line, parseError: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  async record(event: AuditEvent): Promise<void> {
    const redactor = this.opts.redactor ?? redact;
    let line: string;
    try {
      const redacted = redactor(event);
      line = JSON.stringify(redacted) + '\n';
    } catch (err) {
      this.opts.logger?.error({ err: String(err) }, 'audit redaction failed');
      try {
        line =
          JSON.stringify({
            ts: event.ts,
            tool: event.tool,
            result: 'error',
            error: 'audit_redaction_failed',
          }) + '\n';
      } catch {
        return;
      }
    }
    try {
      await mkdir(path.dirname(this.opts.path), { recursive: true });
      await appendFile(this.opts.path, line, { encoding: 'utf8' });
    } catch (err) {
      // never throw from audit; surface to logger and stderr
      this.opts.logger?.error({ err: String(err) }, 'audit append failed');
      process.stderr.write(`audit_write_failed: ${String(err)}\n`);
    }
  }
}

export class NoopAuditLogger implements AuditLogger {
  // eslint-disable-next-line @typescript-eslint/require-await
  async record(_event: AuditEvent): Promise<void> {
    void _event;
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async tail(_n: number): Promise<AuditTailEntry[]> {
    void _n;
    return [];
  }
}
