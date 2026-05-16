import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

const SCHEMA_VERSION = 1 as const;

const PersistedTargetSchema = z.discriminatedUnion('flow_source', [
  z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    env_name: z.string().min(1),
    flow_source: z.literal('admin-api'),
    base_url: z.string().url(),
    /**
     * Optional name of an environment variable holding the bearer token /
     * password for this target. Read by the rehydrator on boot — the value
     * is **never** persisted, only the variable name. Lets one MCP registration
     * serve N protected targets without leaking secrets to disk.
     */
    auth_env_var: z.string().min(1).optional(),
    set_at: z.string().min(1),
  }),
  z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    env_name: z.string().min(1),
    flow_source: z.literal('file'),
    file_path: z.string().min(1),
    set_at: z.string().min(1),
  }),
]);

export type PersistedTarget = z.infer<typeof PersistedTargetSchema>;

export interface PersistenceWarning {
  readonly code: 'parse-error' | 'schema-mismatch' | 'io-error';
  readonly path: string;
  readonly message: string;
}

export function targetStateRoot(envName: string): string {
  return path.join(os.homedir(), '.flow-otter', envName);
}

export function persistedTargetPath(envName: string): string {
  return path.join(targetStateRoot(envName), 'target.json');
}

/**
 * Sorted-key JSON with 2-space indent. Internal config — does not need to
 * match flows.json's 4-space convention but should be byte-stable for
 * round-trip tests.
 */
function stableJson(value: unknown): string {
  function sort(_k: string, v: unknown): unknown {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) out[key] = src[key];
      return out;
    }
    return v;
  }
  return JSON.stringify(value, sort, 2) + '\n';
}

export async function readPersistedTarget(
  envName: string,
): Promise<{ target: PersistedTarget | null; warnings: readonly PersistenceWarning[] }> {
  const filePath = persistedTargetPath(envName);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { target: null, warnings: [] };
    }
    return {
      target: null,
      warnings: [
        {
          code: 'io-error',
          path: filePath,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      target: null,
      warnings: [
        {
          code: 'parse-error',
          path: filePath,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
  const result = PersistedTargetSchema.safeParse(parsed);
  if (!result.success) {
    return {
      target: null,
      warnings: [
        {
          code: 'schema-mismatch',
          path: filePath,
          message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      ],
    };
  }
  if (result.data.env_name !== envName) {
    return {
      target: null,
      warnings: [
        {
          code: 'schema-mismatch',
          path: filePath,
          message: `target.json env_name '${result.data.env_name}' does not match scope '${envName}'`,
        },
      ],
    };
  }
  return { target: result.data, warnings: [] };
}

export interface WriteOptions {
  /** Override for tests; defaults to ISO string of now. */
  setAt?: string;
}

export type WriteTargetInput =
  | { flow_source: 'admin-api'; base_url: string; auth_env_var?: string }
  | { flow_source: 'file'; file_path: string };

export async function writePersistedTarget(
  envName: string,
  target: WriteTargetInput,
  opts: WriteOptions = {},
): Promise<PersistedTarget> {
  const stateRoot = targetStateRoot(envName);
  await mkdir(stateRoot, { recursive: true });
  const setAt = opts.setAt ?? new Date().toISOString();
  const full: PersistedTarget =
    target.flow_source === 'admin-api'
      ? {
          schema_version: SCHEMA_VERSION,
          env_name: envName,
          flow_source: 'admin-api',
          base_url: target.base_url,
          ...(target.auth_env_var !== undefined ? { auth_env_var: target.auth_env_var } : {}),
          set_at: setAt,
        }
      : {
          schema_version: SCHEMA_VERSION,
          env_name: envName,
          flow_source: 'file',
          file_path: target.file_path,
          set_at: setAt,
        };
  const validated = PersistedTargetSchema.parse(full);
  const finalPath = persistedTargetPath(envName);
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmpPath, stableJson(validated), 'utf8');
  await rename(tmpPath, finalPath);
  return validated;
}

export async function clearPersistedTarget(envName: string): Promise<boolean> {
  const filePath = persistedTargetPath(envName);
  try {
    await rm(filePath, { force: false });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export async function persistedTargetAgeSeconds(envName: string): Promise<number | null> {
  const filePath = persistedTargetPath(envName);
  try {
    const s = await stat(filePath);
    return Math.max(0, Math.floor((Date.now() - s.mtimeMs) / 1000));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
