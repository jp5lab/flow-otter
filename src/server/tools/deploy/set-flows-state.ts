import { z } from 'zod';

import { type Tool, ValidationFailedError } from '../_tool.js';

const InputSchema = z
  .object({
    state: z.enum(['start', 'stop']),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  prior_state: z.string(),
  state: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const setFlowsStateTool: Tool<Input, Output> = {
  name: 'set_flows_state',
  description:
    'Start or stop the Node-RED flow runtime. `state:"stop"` suspends all flows (no node deploy/start side effects, runtime stays up). `state:"start"` resumes. Requires `runtimeState.enabled = true` in Node-RED settings.js — 404 returned otherwise. Use stop → deploy → start for safe rollouts against runtimes that own hardware. Deploy-tier; requires ENABLE_DEPLOY_TOOLS=true.',
  tier: 'deploy',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['state'],
    properties: {
      state: {
        type: 'string',
        enum: ['start', 'stop'],
        description: 'Target runtime state.',
      },
    },
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    if (!ctx.noderedClient) {
      throw new ValidationFailedError(
        'set_flows_state requires FLOW_SOURCE=admin-api with a configured NODE_RED_BASE_URL.',
        [],
      );
    }
    const prior = await ctx.noderedClient.getFlowsState();
    const next = await ctx.noderedClient.setFlowsState(input.state);
    ctx.enrichAudit({
      mode: 'deploy',
    });
    return {
      ok: true,
      prior_state: prior.state,
      state: next.state,
    };
  },
};
