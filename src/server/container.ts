import os from 'node:os';
import path from 'node:path';

import type {
  FlowSource,
  FlowSourceDescriptor,
  FlowSourceFingerprint,
  FlowSourceWarning,
  SaveOptions,
} from '../shared/flow-source.js';
import type { FlowsJson } from '../shared/flows-json.js';
import { sha256Hex } from '../shared/hash.js';
import { createLogger, type Logger } from '../shared/logger.js';
import { AdminApiFlowSource } from '../adapters/flowsource/adminapi.js';
import { FileFlowSource } from '../adapters/flowsource/file.js';
import {
  authFromEnv,
  BearerAuth,
  NoAuth,
  PasswordGrantAuth,
  type NodeRedAuth,
} from '../adapters/nodered/auth.js';
import { NodeRedClient } from '../adapters/nodered/client.js';
import { NodeRedCommsClient } from '../adapters/nodered/comms.js';
import { loadNamingContract, NamingContractError } from '../toolkit/naming/load.js';
import type { NamingContract } from '../toolkit/naming/schema.js';
import { FilesystemSnapshotStore } from '../toolkit/snapshot/filesystem.js';
import type { SnapshotStore } from '../toolkit/snapshot/store.js';
import { StagedStore } from '../toolkit/staging/staged-store.js';

import type { AuditLogger } from './audit/jsonl.js';
import { JsonlAuditLogger } from './audit/jsonl.js';
import { loadConfig } from './config/load.js';
import type { Config } from './config/schema.js';
import {
  type PersistedTarget,
  readPersistedTarget,
  writePersistedTarget,
} from './state/persisted-target.js';

const UNCONFIGURED_TARGET_MESSAGE =
  'No Node-RED target configured. Call set_target with a base_url first, or boot with NODE_RED_BASE_URL set.';

class UnconfiguredAdminApiFlowSource implements FlowSource {
  // eslint-disable-next-line @typescript-eslint/require-await
  async load(): Promise<{ flows: FlowsJson; rev: string | null }> {
    throw new Error(UNCONFIGURED_TARGET_MESSAGE);
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async save(_flows: FlowsJson, _opts: SaveOptions): Promise<{ rev: string }> {
    void _flows;
    void _opts;
    throw new Error(UNCONFIGURED_TARGET_MESSAGE);
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async fingerprint(): Promise<FlowSourceFingerprint> {
    throw new Error(UNCONFIGURED_TARGET_MESSAGE);
  }
  describe(): FlowSourceDescriptor {
    return { kind: 'adminapi', target: '<unset>' };
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async inspectWarnings(): Promise<readonly FlowSourceWarning[]> {
    return [
      {
        code: 'no-target-configured',
        message:
          'No Node-RED target is configured. Call set_target with a base_url to point the server at a runtime.',
      },
    ];
  }
}

export interface Container {
  config: Config;
  flowSource: FlowSource;
  snapshots: SnapshotStore;
  staging: StagedStore;
  audit: AuditLogger;
  noderedClient?: NodeRedClient;
  /**
   * Live `/comms` WebSocket client + ring buffer for debug messages. Present
   * only when `FLOW_SOURCE === 'admin-api'`. Lazy: constructed at target-bind
   * time but does not call `connect()` until first use.
   */
  comms?: NodeRedCommsClient;
  /**
   * Active auth strategy. Exposed so the shutdown path can call `auth.revoke()`
   * without traversing the client's internals.
   */
  auth: NodeRedAuth;
  logger: Logger;
  clock: () => Date;
  serverVersion: string;
  namingContract?: NamingContract;
  /**
   * Stable per-process identifier. Derived once at boot. Used to tag staged
   * changes (`staged.agent_id`) so `deploy_staged_change` can detect when a
   * different concurrent session is about to push someone else's stage.
   * Default: `FLOWOTTER_SESSION_ID` env var if set, else `pid-${process.pid}`.
   */
  agentId: string;
}

export interface BuildContainerOptions {
  env?: NodeJS.ProcessEnv;
  serverVersion: string;
  /** Override clock for tests. Production uses `Date`. */
  clock?: () => Date;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
}

interface TargetBoundFields {
  flowSource: FlowSource;
  noderedClient?: NodeRedClient;
  comms?: NodeRedCommsClient;
  snapshots: SnapshotStore;
  staging: StagedStore;
  audit: AuditLogger;
  auth: NodeRedAuth;
}

function buildTargetBound(
  config: Config,
  auth: NodeRedAuth,
  logger: Logger,
  serverVersion: string,
  fetchImpl?: typeof fetch,
): TargetBoundFields {
  let flowSource: FlowSource;
  let noderedClient: NodeRedClient | undefined;
  let comms: NodeRedCommsClient | undefined;
  if (config.FLOW_SOURCE === 'file') {
    flowSource = new FileFlowSource({ path: config.FLOW_FILE_PATH });
  } else if (config.NODE_RED_BASE_URL) {
    noderedClient = new NodeRedClient({
      baseUrl: config.NODE_RED_BASE_URL,
      auth,
      timeoutMs: config.REQUEST_TIMEOUT_MS,
      logger,
      userAgent: `FlowOtter/${serverVersion}`,
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    });
    flowSource = new AdminApiFlowSource(noderedClient);
    comms = new NodeRedCommsClient({
      baseUrl: config.NODE_RED_BASE_URL,
      auth,
      bufferSize: config.DEBUG_BUFFER_SIZE,
      logger,
    });
  } else {
    flowSource = new UnconfiguredAdminApiFlowSource();
  }
  const snapshots: SnapshotStore = new FilesystemSnapshotStore({
    rootDir: config.SNAPSHOT_DIR,
    retentionKeepLast: config.SNAPSHOT_RETENTION,
    // Snapshots tagged 'pre-dangerous' or 'pre-deploy-forced' are operator
    // safety nets — keep them even when over the retention budget.
    retentionProtectTags: ['pre-dangerous', 'forced'],
  });
  const staging = new StagedStore({ dir: config.STAGING_DIR });
  const audit: AuditLogger = new JsonlAuditLogger({ path: config.AUDIT_LOG_PATH, logger });
  return {
    flowSource,
    ...(noderedClient !== undefined ? { noderedClient } : {}),
    ...(comms !== undefined ? { comms } : {}),
    snapshots,
    staging,
    audit,
    auth,
  };
}

export function buildContainer(opts: BuildContainerOptions): Container {
  const env = opts.env ?? process.env;
  const config = loadConfig(env);
  const logger = createLogger({ level: config.LOG_LEVEL });
  const clock = opts.clock ?? ((): Date => new Date());

  const auth: NodeRedAuth = config.NODE_RED_BASE_URL
    ? authFromEnv(env, config.NODE_RED_BASE_URL)
    : new NoAuth();
  const bound = buildTargetBound(config, auth, logger, opts.serverVersion, opts.fetchImpl);

  let namingContract: NamingContract | undefined;
  try {
    namingContract = loadNamingContract(config.NAMING_CONTRACT_PATH) ?? undefined;
  } catch (err) {
    if (err instanceof NamingContractError) {
      logger.warn({ err: err.message }, 'failed to load naming contract; using built-in fallback');
    } else {
      throw err;
    }
  }

  const agentId = env['FLOWOTTER_SESSION_ID'] || `pid-${process.pid}`;

  return {
    config,
    flowSource: bound.flowSource,
    snapshots: bound.snapshots,
    staging: bound.staging,
    auth: bound.auth,
    audit: bound.audit,
    ...(bound.noderedClient !== undefined ? { noderedClient: bound.noderedClient } : {}),
    ...(bound.comms !== undefined ? { comms: bound.comms } : {}),
    logger,
    clock,
    serverVersion: opts.serverVersion,
    agentId,
    ...(namingContract !== undefined ? { namingContract } : {}),
  };
}

export type ApplyTargetOptions =
  | {
      kind: 'admin-api';
      base_url: string;
      env_name?: string;
      auth_token?: string;
      username?: string;
      password?: string;
      snapshot_dir?: string;
      staging_dir?: string;
      audit_log_path?: string;
      fetchImpl?: typeof fetch;
    }
  | {
      kind: 'file';
      file_path: string;
      env_name?: string;
      snapshot_dir?: string;
      staging_dir?: string;
      audit_log_path?: string;
    };

export interface AppliedTarget {
  flow_source: 'admin-api' | 'file';
  env_name: string;
  base_url?: string;
  file_path?: string;
  snapshot_dir: string;
  staging_dir: string;
  audit_log_path: string;
}

function deriveEnvNameFromUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  const host = u.hostname.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return u.port ? `${host}_${u.port}` : host;
}

function deriveEnvNameFromPath(filePath: string): string {
  const abs = path.resolve(filePath);
  const parent = path.basename(path.dirname(abs)).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'flows';
  const suffix = sha256Hex(abs).slice(0, 6);
  return `${parent}_${suffix}`;
}

/**
 * Mutates the container in place to point at a new target (admin-api OR file).
 * Re-scopes snapshot, staging, and audit storage under `~/.flow-otter/<env_name>/`
 * unless caller supplies explicit paths. Subsequent tool invocations see the
 * new state. Does NOT write target.json — callers that want persistence (e.g.
 * the set_target tool) must call `writePersistedTarget` separately.
 */
export function applyTarget(container: Container, opts: ApplyTargetOptions): AppliedTarget {
  if (opts.kind === 'admin-api') {
    return applyAdminApiTarget(container, opts);
  }
  return applyFileTarget(container, opts);
}

function applyAdminApiTarget(
  container: Container,
  opts: Extract<ApplyTargetOptions, { kind: 'admin-api' }>,
): AppliedTarget {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(opts.base_url);
  } catch {
    throw new Error(`Invalid base_url: ${opts.base_url}`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`base_url must use http(s); got ${parsedUrl.protocol}`);
  }

  const envName = opts.env_name ?? deriveEnvNameFromUrl(opts.base_url);
  const stateRoot = path.join(os.homedir(), '.flow-otter', envName);
  const snapshotDir = opts.snapshot_dir ?? path.join(stateRoot, 'snapshots');
  const stagingDir = opts.staging_dir ?? path.join(stateRoot, 'staging');
  const auditLogPath = opts.audit_log_path ?? path.join(stateRoot, 'audit.jsonl');

  const newConfig: Config = Object.freeze({
    ...container.config,
    NODE_RED_BASE_URL: opts.base_url,
    NODE_RED_AUTH_TOKEN: opts.auth_token ?? container.config.NODE_RED_AUTH_TOKEN,
    NODE_RED_USERNAME: opts.username ?? container.config.NODE_RED_USERNAME,
    NODE_RED_PASSWORD: opts.password ?? container.config.NODE_RED_PASSWORD,
    FLOW_SOURCE: 'admin-api',
    SNAPSHOT_DIR: snapshotDir,
    STAGING_DIR: stagingDir,
    AUDIT_LOG_PATH: auditLogPath,
    ENVIRONMENT_NAME: envName,
  });

  let auth: NodeRedAuth;
  if (opts.auth_token) {
    auth = new BearerAuth(opts.auth_token);
  } else if (opts.username && opts.password) {
    auth = new PasswordGrantAuth({
      baseUrl: opts.base_url,
      username: opts.username,
      password: opts.password,
    });
  } else {
    auth = new NoAuth();
  }

  const bound = buildTargetBound(
    newConfig,
    auth,
    container.logger,
    container.serverVersion,
    opts.fetchImpl,
  );

  container.config = newConfig;
  container.flowSource = bound.flowSource;
  if (bound.noderedClient !== undefined) {
    container.noderedClient = bound.noderedClient;
  } else {
    delete container.noderedClient;
  }
  // Dispose any prior comms client before installing the new one so we don't
  // leak a socket pointing at the old target.
  if (container.comms !== undefined) {
    try {
      container.comms.dispose();
    } catch {
      // best-effort
    }
  }
  if (bound.comms !== undefined) {
    container.comms = bound.comms;
  } else {
    delete container.comms;
  }
  container.snapshots = bound.snapshots;
  container.staging = bound.staging;
  container.audit = bound.audit;
  // Best-effort revoke the prior auth so we don't accumulate dead sessions.
  void container.auth.revoke().catch(() => undefined);
  container.auth = bound.auth;

  return {
    flow_source: 'admin-api',
    base_url: opts.base_url,
    env_name: envName,
    snapshot_dir: snapshotDir,
    staging_dir: stagingDir,
    audit_log_path: auditLogPath,
  };
}

function applyFileTarget(
  container: Container,
  opts: Extract<ApplyTargetOptions, { kind: 'file' }>,
): AppliedTarget {
  const absPath = path.resolve(opts.file_path);
  const envName = opts.env_name ?? deriveEnvNameFromPath(absPath);
  const stateRoot = path.join(os.homedir(), '.flow-otter', envName);
  const snapshotDir = opts.snapshot_dir ?? path.join(stateRoot, 'snapshots');
  const stagingDir = opts.staging_dir ?? path.join(stateRoot, 'staging');
  const auditLogPath = opts.audit_log_path ?? path.join(stateRoot, 'audit.jsonl');

  const newConfig: Config = Object.freeze({
    ...container.config,
    FLOW_SOURCE: 'file',
    FLOW_FILE_PATH: absPath,
    SNAPSHOT_DIR: snapshotDir,
    STAGING_DIR: stagingDir,
    AUDIT_LOG_PATH: auditLogPath,
    ENVIRONMENT_NAME: envName,
  });

  const auth: NodeRedAuth = new NoAuth();
  const bound = buildTargetBound(newConfig, auth, container.logger, container.serverVersion);

  container.config = newConfig;
  container.flowSource = bound.flowSource;
  delete container.noderedClient;
  if (container.comms !== undefined) {
    try {
      container.comms.dispose();
    } catch {
      // best-effort
    }
    delete container.comms;
  }
  container.snapshots = bound.snapshots;
  container.staging = bound.staging;
  container.audit = bound.audit;
  void container.auth.revoke().catch(() => undefined);
  container.auth = bound.auth;

  return {
    flow_source: 'file',
    file_path: absPath,
    env_name: envName,
    snapshot_dir: snapshotDir,
    staging_dir: stagingDir,
    audit_log_path: auditLogPath,
  };
}

export interface RehydrationResult {
  readonly rehydrated: boolean;
  readonly applied?: AppliedTarget;
  readonly source?: PersistedTarget;
  readonly warnings: readonly { code: string; path: string; message: string }[];
  readonly skipped_because?: 'explicit-base-url' | 'explicit-file-path';
}

/**
 * Boot-time rehydration: if no explicit target env vars (`NODE_RED_BASE_URL`,
 * `FLOW_FILE_PATH`) were supplied to the process, look up
 * `~/.flow-otter/<ENVIRONMENT_NAME>/target.json` and apply it.
 *
 * Explicit env vars always win — they're the operator's deliberate pin and
 * persistence should never override them.
 */
export async function rehydrateFromPersistedTarget(
  container: Container,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RehydrationResult> {
  if (env.NODE_RED_BASE_URL !== undefined) {
    return { rehydrated: false, warnings: [], skipped_because: 'explicit-base-url' };
  }
  if (env.FLOW_FILE_PATH !== undefined) {
    return { rehydrated: false, warnings: [], skipped_because: 'explicit-file-path' };
  }

  const envName = container.config.ENVIRONMENT_NAME;
  const { target, warnings } = await readPersistedTarget(envName);
  if (!target) {
    return { rehydrated: false, warnings };
  }

  let applied: AppliedTarget;
  if (target.flow_source === 'admin-api') {
    // Resolve auth_env_var if set — bridge protected-runtime targets without
    // ever persisting the token itself.
    let authToken: string | undefined;
    if (target.auth_env_var !== undefined) {
      const value = env[target.auth_env_var];
      if (typeof value === 'string' && value.length > 0) {
        authToken = value;
      } else {
        container.logger.warn(
          { env_var: target.auth_env_var },
          'persisted target references auth_env_var that is unset or empty; proceeding without auth',
        );
      }
    }
    applied = applyTarget(container, {
      kind: 'admin-api',
      base_url: target.base_url,
      env_name: target.env_name,
      ...(authToken !== undefined ? { auth_token: authToken } : {}),
    });
  } else {
    applied = applyTarget(container, {
      kind: 'file',
      file_path: target.file_path,
      env_name: target.env_name,
    });
  }
  return { rehydrated: true, applied, source: target, warnings };
}

/**
 * Persist `applied` to `~/.flow-otter/<env_name>/target.json` so the next process
 * with the same `ENVIRONMENT_NAME` can rehydrate it. The auth-token value is
 * **never** persisted; an optional `auth_env_var` name (where the token lives
 * in process env) can be stored so rehydration knows where to read it from.
 */
export async function persistAppliedTarget(
  applied: AppliedTarget,
  opts: { auth_env_var?: string } = {},
): Promise<PersistedTarget> {
  if (applied.flow_source === 'admin-api') {
    if (applied.base_url === undefined) {
      throw new Error('admin-api applied target missing base_url');
    }
    return writePersistedTarget(applied.env_name, {
      flow_source: 'admin-api',
      base_url: applied.base_url,
      ...(opts.auth_env_var !== undefined ? { auth_env_var: opts.auth_env_var } : {}),
    });
  }
  if (applied.file_path === undefined) {
    throw new Error('file applied target missing file_path');
  }
  return writePersistedTarget(applied.env_name, {
    flow_source: 'file',
    file_path: applied.file_path,
  });
}
