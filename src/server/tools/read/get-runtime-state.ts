import { z } from 'zod';

import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  /**
   * Node-RED `/flows/state` returns `start` or `stop` (verbs, not adjectives).
   * Always present. When `runtimeState.enabled` is false the runtime returns
   * `start` regardless of actual state; in that case the `runtime_state_enabled`
   * flag below is false and callers should treat `state` as advisory.
   */
  state: z.string(),
  /**
   * Safe-mode is orthogonal to start/stop, not a third state value. Sourced
   * from `/diagnostics` (`runtime.safeMode`). When safe-mode is active, flow
   * execution is suspended even if `state === 'start'`.
   */
  safe_mode: z.boolean(),
  /**
   * True when `runtimeState.enabled` is on in Node-RED settings — POST /flows/state
   * works to start/stop the runtime. False when the feature is administratively
   * disabled (the GET response is meaningless in that mode).
   */
  runtime_state_enabled: z.boolean(),
  diagnostics: z.record(z.unknown()).nullable(),
  diagnostics_error: z.string().optional(),
});
type Output = z.infer<typeof OutputSchema>;

export const getRuntimeStateTool: Tool<Input, Output> = {
  name: 'get_runtime_state',
  description:
    'Returns the Node-RED runtime state. `state` is start/stop (from /flows/state). `safe_mode` is orthogonal — when true, flows are suspended regardless of state. `runtime_state_enabled` reports whether the runtimeState API is administratively enabled. Requires FLOW_SOURCE=admin-api.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    if (!ctx.noderedClient) {
      throw new ValidationFailedError(
        'get_runtime_state requires FLOW_SOURCE=admin-api with a configured NODE_RED_BASE_URL.',
        [],
      );
    }
    const flowsState = await ctx.noderedClient.getFlowsState();
    let diagnostics: Record<string, unknown> | null = null;
    let diagnosticsError: string | undefined;
    try {
      diagnostics = await ctx.noderedClient.getDiagnostics();
    } catch (err) {
      diagnosticsError = err instanceof Error ? err.message : String(err);
    }
    let safeMode = false;
    let runtimeStateEnabled = false;
    if (diagnostics !== null) {
      const runtime = diagnostics['runtime'] as Record<string, unknown> | undefined;
      if (runtime !== undefined) {
        if (runtime['safeMode'] === true) safeMode = true;
        // runtime.state may carry an enabled flag; per Node-RED source the
        // diagnostics payload includes settings.runtimeState.enabled mirror.
        const settings = diagnostics['settings'] as Record<string, unknown> | undefined;
        const rtState = settings?.['runtimeState'] as Record<string, unknown> | undefined;
        if (rtState?.['enabled'] === true) runtimeStateEnabled = true;
      }
    }
    return {
      state: flowsState.state,
      safe_mode: safeMode,
      runtime_state_enabled: runtimeStateEnabled,
      diagnostics,
      ...(diagnosticsError !== undefined ? { diagnostics_error: diagnosticsError } : {}),
    };
  },
};
