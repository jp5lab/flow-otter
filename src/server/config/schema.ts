import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

const homeBased = (rel: string): string => path.join(os.homedir(), '.flow-otter', rel);

const truthy = ['1', 'true', 'TRUE', 'True', 'yes', 'on'];
const falsy = ['0', 'false', 'FALSE', 'False', 'no', 'off', ''];

const boolFromEnv = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return v;
  if (truthy.includes(v)) return true;
  if (falsy.includes(v)) return false;
  return v;
}, z.boolean());

const intFromEnv = z.preprocess(
  (v) => (typeof v === 'string' ? Number.parseInt(v, 10) : v),
  z.number().int(),
);

export const ConfigSchema = z.object({
  NODE_RED_BASE_URL: z.string().url().optional(),
  NODE_RED_AUTH_TOKEN: z.string().optional(),
  NODE_RED_USERNAME: z.string().optional(),
  NODE_RED_PASSWORD: z.string().optional(),

  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),

  READ_ONLY_MODE: boolFromEnv.default(true),
  DRY_RUN_MODE: boolFromEnv.default(false),
  ENABLE_WRITE_TOOLS: boolFromEnv.default(false),
  ENABLE_DEPLOY_TOOLS: boolFromEnv.default(false),
  ENABLE_DANGEROUS_TOOLS: boolFromEnv.default(false),

  FLOW_SOURCE: z.enum(['file', 'admin-api']).default('admin-api'),
  FLOW_FILE_PATH: z.string().default('./flows.json'),

  SNAPSHOT_DIR: z.string().default(homeBased('snapshots')),
  SNAPSHOT_RETENTION: intFromEnv.refine((n) => n > 0).default(50),
  STAGING_DIR: z.string().default(homeBased('staging')),
  AUDIT_LOG_PATH: z.string().default(homeBased('audit.jsonl')),

  MAX_FLOW_SIZE_BYTES: intFromEnv.refine((n) => n > 0).default(10_485_760),
  ALLOWED_DEPLOYMENT_MODES: z.string().default('nodes,flows'),
  ALLOWED_NODE_TYPES: z.string().default(''),
  BLOCKED_NODE_TYPES: z.string().default(''),
  REQUEST_TIMEOUT_MS: intFromEnv.refine((n) => n > 0).default(30_000),

  REQUIRE_SNAPSHOT_BEFORE_DEPLOY: boolFromEnv.default(true),
  REQUIRE_DIFF_BEFORE_DEPLOY: boolFromEnv.default(true),
  REQUIRE_DRIFT_CHECK_BEFORE_DEPLOY: boolFromEnv.default(true),

  LABEL_CAP_CHARS: intFromEnv.refine((n) => n > 0).default(24),
  CANVAS_MAX_X: intFromEnv.refine((n) => n > 0).default(2400),
  CANVAS_MAX_Y: intFromEnv.refine((n) => n > 0).default(1600),
  NAMING_CONTRACT_PATH: z.string().default('./naming.yaml'),

  DEBUG_BUFFER_SIZE: intFromEnv.refine((n) => n >= 1 && n <= 10_000).default(500),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  ENVIRONMENT_NAME: z.string().default('local'),
  ACTOR_NAME: z.string().default('agent'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const ALL_CONFIG_KEYS: readonly (keyof Config)[] = [
  'NODE_RED_BASE_URL',
  'NODE_RED_AUTH_TOKEN',
  'NODE_RED_USERNAME',
  'NODE_RED_PASSWORD',
  'MCP_TRANSPORT',
  'READ_ONLY_MODE',
  'DRY_RUN_MODE',
  'ENABLE_WRITE_TOOLS',
  'ENABLE_DEPLOY_TOOLS',
  'ENABLE_DANGEROUS_TOOLS',
  'FLOW_SOURCE',
  'FLOW_FILE_PATH',
  'SNAPSHOT_DIR',
  'SNAPSHOT_RETENTION',
  'STAGING_DIR',
  'AUDIT_LOG_PATH',
  'MAX_FLOW_SIZE_BYTES',
  'ALLOWED_DEPLOYMENT_MODES',
  'ALLOWED_NODE_TYPES',
  'BLOCKED_NODE_TYPES',
  'REQUEST_TIMEOUT_MS',
  'REQUIRE_SNAPSHOT_BEFORE_DEPLOY',
  'REQUIRE_DIFF_BEFORE_DEPLOY',
  'REQUIRE_DRIFT_CHECK_BEFORE_DEPLOY',
  'LABEL_CAP_CHARS',
  'CANVAS_MAX_X',
  'CANVAS_MAX_Y',
  'NAMING_CONTRACT_PATH',
  'DEBUG_BUFFER_SIZE',
  'LOG_LEVEL',
  'ENVIRONMENT_NAME',
  'ACTOR_NAME',
];

export const SECRET_CONFIG_KEYS: readonly (keyof Config)[] = [
  'NODE_RED_AUTH_TOKEN',
  'NODE_RED_PASSWORD',
];
