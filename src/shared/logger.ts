import pino from 'pino';

export type Logger = pino.Logger;

export interface LoggerOptions {
  level?: pino.LevelWithSilent;
  destination?: pino.DestinationStream;
}

/**
 * Paths to redact from log lines and audit-friendly serializations.
 *
 * Belt and suspenders: the audit-log subsystem in `src/server/audit/redact.ts`
 * does its own deeper redaction; this list catches accidental top-level leaks.
 */
const REDACT_PATHS = [
  'token',
  'password',
  'authorization',
  'auth_token',
  'credentials',
  '*.token',
  '*.password',
  '*.authorization',
  '*.credentials',
  'config.NODE_RED_AUTH_TOKEN',
  'config.NODE_RED_PASSWORD',
];

/**
 * Creates a pino logger that writes to **stderr** by default. STDIO MCP servers
 * use stdout for the JSON-RPC protocol; logging there would corrupt the stream.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const destination = opts.destination ?? pino.destination({ dest: 2, sync: false });
  return pino(
    {
      level: opts.level ?? (process.env['LOG_LEVEL'] as pino.LevelWithSilent | undefined) ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '***REDACTED***' },
    },
    destination,
  );
}
