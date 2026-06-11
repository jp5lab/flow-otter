import { z } from 'zod';

import { rasterizerAvailable } from '../../../toolkit/render/png.js';
import { getOrProbeRuntimeInfo } from '../../runtime-info.js';
import { persistedTargetAgeSeconds, persistedTargetPath } from '../../state/persisted-target.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const WarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});

const RuntimeInfoSchema = z.object({
  name: z.literal('node-red'),
  version: z.string(),
  is_prerelease: z.boolean(),
  node_js_version: z.string().optional(),
  detected_at: z.string(),
  capabilities: z.record(z.boolean()),
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
  /**
   * Detected info about the connected Node-RED runtime. Present when the
   * target is admin-api AND the /settings probe succeeded. Absent for
   * file-source targets or when the probe failed (a warning is added in
   * that case).
   */
  runtime: RuntimeInfoSchema.optional(),
  /**
   * True when the optional `@resvg/resvg-js` rasterizer is loadable, i.e.
   * `render_flow_png` will work. When false, PNG tools HARD-FAIL with
   * RasterizerUnavailableError (REND-5) — there is no silent SVG fallback.
   */
  rasterizer_available: z.boolean(),
  warnings: z.array(WarningSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const healthCheckTool: Tool<Input, Output> = {
  name: 'health_check',
  description:
    'Reports server liveness, version, configured flow source, reachability, env_name + persisted-target.json status, rasterizer_available (whether render_flow_png can work), and any environment-shape warnings (e.g. project-mode flowFile mismatches, no-target-configured). Read-only.',
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

    // Probe Node-RED for its version + capabilities. Only meaningful when
    // the target is admin-api AND reachable; for file sources and
    // unreachable runtimes, runtimeInfo will be undefined.
    const allWarnings = warnings.map((w) => ({
      code: w.code,
      message: w.message,
      ...(w.hint !== undefined ? { hint: w.hint } : {}),
    }));
    let runtime: Output['runtime'];
    if (reachable && ctx.container.noderedClient !== undefined) {
      const probe = await getOrProbeRuntimeInfo(ctx.container, ctx.clock);
      if (probe.info !== undefined) runtime = probe.info;
      if (probe.warning !== undefined) {
        allWarnings.push({ code: probe.warning.code, message: probe.warning.message });
      }
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
      ...(runtime !== undefined ? { runtime } : {}),
      rasterizer_available: await rasterizerAvailable(),
      warnings: allWarnings,
    };
  },
};
