import { z } from 'zod';

import { applyTarget, type ApplyTargetOptions, persistAppliedTarget } from '../../container.js';
import { persistedTargetPath } from '../../state/persisted-target.js';
import type { Tool } from '../_tool.js';

const AdminApiInput = z
  .object({
    flow_source: z.literal('admin-api').optional(),
    base_url: z.string().url(),
    env_name: z.string().min(1).optional(),
    auth_token: z.string().min(1).optional(),
    auth_env_var: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    snapshot_dir: z.string().min(1).optional(),
    staging_dir: z.string().min(1).optional(),
    audit_log_path: z.string().min(1).optional(),
    persist: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasUser = val.username !== undefined;
    const hasPass = val.password !== undefined;
    if (hasUser !== hasPass) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'username and password must be supplied together',
        path: hasUser ? ['password'] : ['username'],
      });
    }
  });

const FileInput = z
  .object({
    flow_source: z.literal('file'),
    file_path: z.string().min(1),
    env_name: z.string().min(1).optional(),
    snapshot_dir: z.string().min(1).optional(),
    staging_dir: z.string().min(1).optional(),
    audit_log_path: z.string().min(1).optional(),
    persist: z.boolean().optional(),
  })
  .strict();

const InputSchema = z.union([AdminApiInput, FileInput]);
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  flow_source: z.enum(['admin-api', 'file']),
  env_name: z.string(),
  base_url: z.string().optional(),
  file_path: z.string().optional(),
  snapshot_dir: z.string(),
  staging_dir: z.string(),
  audit_log_path: z.string(),
  reachable: z.boolean(),
  reachable_error: z.string().optional(),
  persisted: z.boolean(),
  persisted_target_path: z.string().optional(),
});
type Output = z.infer<typeof OutputSchema>;

function isFileInput(input: Input): input is z.infer<typeof FileInput> {
  return (input as { flow_source?: string }).flow_source === 'file';
}

export const setTargetTool: Tool<Input, Output> = {
  name: 'set_target',
  description:
    'Point the server at a Node-RED target at runtime. Switches FLOW_SOURCE, swaps client/auth/file source, and re-scopes snapshot/staging/audit storage under ~/.flow-otter/<env_name>/. By default writes ~/.flow-otter/<env_name>/target.json so the next process boot rehydrates this target automatically; pass persist:false to skip. Auth tokens are NEVER persisted. Read-tier (always available) but does mutate local state (live container rebind + target.json by default), so client UIs should not treat it as side-effect-free.',
  tier: 'read',
  // Read-tier defaults set readOnlyHint: true, but set_target rebinds the
  // live container and writes target.json by default. Override hints to
  // accurately surface the side effect to client UIs.
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: false,
  },
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    description:
      'Two mutually exclusive modes, validated at runtime by inputZod: (1) admin-api mode — supply base_url plus optional auth (auth_token | auth_env_var | username+password); flow_source defaults to "admin-api". (2) file mode — supply flow_source:"file" and file_path. Mixing fields across modes is rejected.',
    properties: {
      flow_source: {
        type: 'string',
        enum: ['admin-api', 'file'],
        description:
          'Selects the mode. Required as "file" for file mode; optional in admin-api mode (defaults to "admin-api").',
      },
      base_url: {
        type: 'string',
        format: 'uri',
        description: 'admin-api mode: Node-RED Admin API base URL (e.g. http://192.168.1.10:1880).',
      },
      file_path: {
        type: 'string',
        minLength: 1,
        description: 'file mode: Absolute or relative path to a flows.json file.',
      },
      env_name: {
        type: 'string',
        minLength: 1,
        description:
          'Label for snapshot/staging/audit scope. admin-api mode defaults to URL host(_port), sanitised. file mode defaults to <parent-dir>_<6-char-hash>.',
      },
      auth_token: {
        type: 'string',
        minLength: 1,
        description:
          'admin-api mode only. Bearer token. Takes precedence over username/password. NEVER persisted.',
      },
      auth_env_var: {
        type: 'string',
        minLength: 1,
        description:
          'admin-api mode only. Name of env var holding the bearer token. Resolved at apply time; the token value itself is NEVER persisted.',
      },
      username: {
        type: 'string',
        minLength: 1,
        description: 'admin-api mode only. Must be paired with password.',
      },
      password: {
        type: 'string',
        minLength: 1,
        description: 'admin-api mode only. NEVER persisted.',
      },
      snapshot_dir: { type: 'string', minLength: 1 },
      staging_dir: { type: 'string', minLength: 1 },
      audit_log_path: { type: 'string', minLength: 1 },
      persist: {
        type: 'boolean',
        description:
          'Default true. When true, writes ~/.flow-otter/<env_name>/target.json so the next boot rehydrates.',
      },
    },
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    let applyOpts: ApplyTargetOptions;
    if (isFileInput(input)) {
      applyOpts = {
        kind: 'file',
        file_path: input.file_path,
        ...(input.env_name !== undefined ? { env_name: input.env_name } : {}),
        ...(input.snapshot_dir !== undefined ? { snapshot_dir: input.snapshot_dir } : {}),
        ...(input.staging_dir !== undefined ? { staging_dir: input.staging_dir } : {}),
        ...(input.audit_log_path !== undefined ? { audit_log_path: input.audit_log_path } : {}),
      };
    } else {
      // If auth_env_var is supplied (no inline auth_token), resolve the token
      // from the process env now so the live container has auth — without
      // ever persisting the value itself.
      let resolvedAuthToken = input.auth_token;
      if (
        input.auth_env_var !== undefined &&
        resolvedAuthToken === undefined &&
        input.username === undefined
      ) {
        const v = process.env[input.auth_env_var];
        if (typeof v === 'string' && v.length > 0) resolvedAuthToken = v;
      }
      applyOpts = {
        kind: 'admin-api',
        base_url: input.base_url,
        ...(input.env_name !== undefined ? { env_name: input.env_name } : {}),
        ...(resolvedAuthToken !== undefined ? { auth_token: resolvedAuthToken } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.password !== undefined ? { password: input.password } : {}),
        ...(input.snapshot_dir !== undefined ? { snapshot_dir: input.snapshot_dir } : {}),
        ...(input.staging_dir !== undefined ? { staging_dir: input.staging_dir } : {}),
        ...(input.audit_log_path !== undefined ? { audit_log_path: input.audit_log_path } : {}),
      };
    }

    const applied = applyTarget(ctx.container, applyOpts);

    let reachable = false;
    let reachableError: string | undefined;
    try {
      await ctx.container.flowSource.fingerprint();
      reachable = true;
    } catch (err) {
      reachableError = err instanceof Error ? err.message : String(err);
    }

    const shouldPersist = input.persist !== false;
    let persistedPath: string | undefined;
    if (shouldPersist) {
      try {
        const persistOpts: { auth_env_var?: string } = {};
        if (!isFileInput(input) && input.auth_env_var !== undefined) {
          persistOpts.auth_env_var = input.auth_env_var;
        }
        await persistAppliedTarget(applied, persistOpts);
        persistedPath = persistedTargetPath(applied.env_name);
      } catch (err) {
        ctx.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to write persisted target.json',
        );
      }
    }

    return {
      ok: true,
      flow_source: applied.flow_source,
      env_name: applied.env_name,
      ...(applied.base_url !== undefined ? { base_url: applied.base_url } : {}),
      ...(applied.file_path !== undefined ? { file_path: applied.file_path } : {}),
      snapshot_dir: applied.snapshot_dir,
      staging_dir: applied.staging_dir,
      audit_log_path: applied.audit_log_path,
      reachable,
      ...(reachableError !== undefined ? { reachable_error: reachableError } : {}),
      persisted: persistedPath !== undefined,
      ...(persistedPath !== undefined ? { persisted_target_path: persistedPath } : {}),
    };
  },
};
