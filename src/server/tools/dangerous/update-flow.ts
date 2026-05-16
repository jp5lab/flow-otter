import { z } from 'zod';

import { canonicalHash } from '../../../shared/hash.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { assertDangerousToken } from './_confirmation.js';

const InputSchema = z
  .object({
    flow_id: z.string().min(1),
    flow: z.unknown(),
    confirmation_token: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  updated_id: z.string(),
  snapshot_before: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const updateFlowTool: Tool<Input, Output> = {
  name: 'update_flow',
  description:
    'Dangerous: replaces a single Node-RED flow (tab) by id via the Admin API PUT /flow/:id endpoint. Bypasses staging — the runtime sees the change immediately. Requires ENABLE_DANGEROUS_TOOLS and a `prepare_dangerous_operation` token scoped to (flow_id, flow body hash). A pre-mutation snapshot of the runtime is recorded for rollback.',
  tier: 'dangerous',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      flow_id: { type: 'string', minLength: 1 },
      flow: { type: 'object' },
      confirmation_token: { type: 'string', minLength: 1 },
    },
    required: ['flow_id', 'flow', 'confirmation_token'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    if (ctx.noderedClient === undefined) {
      throw new ValidationFailedError(
        'update_flow requires an admin-api target. Call set_target first.',
        [],
      );
    }
    const flowsHash = canonicalHash(input.flow);
    assertDangerousToken(input.confirmation_token, {
      operation: 'update_flow',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      target: input.flow_id,
      flowsHash,
    });

    const { flows: runtimeFlows, rev: runtimeRev } = await ctx.flowSource.load();
    const preSnap = await ctx.snapshots.save({
      flows: runtimeFlows,
      rev: runtimeRev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: 'pre-dangerous-update-flow',
      takenAt: ctx.clock().toISOString(),
      tags: ['pre-dangerous', 'update-flow'],
      serverVersion: ctx.serverVersion,
    });

    await ctx.noderedClient.updateFlow(input.flow_id, input.flow);

    ctx.enrichAudit({
      mode: 'dangerous',
      snapshot_before: preSnap.id,
    });

    return {
      ok: true,
      updated_id: input.flow_id,
      snapshot_before: preSnap.id,
    };
  },
};
