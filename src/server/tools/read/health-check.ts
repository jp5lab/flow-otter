import { z } from 'zod';

import { persistedTargetAgeSeconds, persistedTargetPath } from '../../state/persisted-target.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const WarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  server_version: z.string(),
  flow_source: z.object({ kind: z.enum(['file', 'adminapi']), target: z.string() }),
  read_only_mode: z.boolean(),
  flow_source_reachable: z.boolean(),
  flow_source_error: z.string().optional(),
  env_name: z.string(),
  persisted_target_path: z.string(),
  persisted_target_age_seconds: z.number().nullable(),
  warnings: z.array(WarningSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const healthCheckTool: Tool<Input, Output> = {
  name: 'health_check',
  description:
    'Reports server liveness, version, configured flow source, reachability, env_name + persisted-target.json status, and any environment-shape warnings (e.g. project-mode flowFile mismatches, no-target-configured). Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    let reachable = false;
    let error: string | undefined;
    try {
      await ctx.flowSource.fingerprint();
      reachable = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    let warnings: readonly { code: string; message: string; hint?: string }[] = [];
    try {
      warnings = await ctx.flowSource.inspectWarnings();
    } catch {
      // inspectWarnings is advisory; do not let its failure break health_check.
    }
    const envName = ctx.config.ENVIRONMENT_NAME;
    let ageSeconds: number | null = null;
    try {
      ageSeconds = await persistedTargetAgeSeconds(envName);
    } catch {
      // Stat failure is advisory; report null.
    }
    return {
      ok: reachable,
      server_version: ctx.serverVersion,
      flow_source: ctx.flowSource.describe(),
      read_only_mode: ctx.config.READ_ONLY_MODE,
      flow_source_reachable: reachable,
      ...(error !== undefined ? { flow_source_error: error } : {}),
      env_name: envName,
      persisted_target_path: persistedTargetPath(envName),
      persisted_target_age_seconds: ageSeconds,
      warnings: warnings.map((w) => ({
        code: w.code,
        message: w.message,
        ...(w.hint !== undefined ? { hint: w.hint } : {}),
      })),
    };
  },
};
