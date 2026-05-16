import { z } from 'zod';

import { type Tool, ValidationFailedError } from '../_tool.js';

import { assertDangerousToken } from './_confirmation.js';

const InputSchema = z
  .object({
    flow_id: z.string().min(1),
    confirmation_token: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  deleted_id: z.string(),
  snapshot_before: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const deleteFlowTool: Tool<Input, Output> = {
  name: 'delete_flow',
  description:
    'Dangerous: deletes a single Node-RED flow (tab) by id via the Admin API DELETE /flow/:id endpoint. Bypasses staging — the runtime sees the change immediately. Requires ENABLE_DANGEROUS_TOOLS and a `prepare_dangerous_operation` token scoped to flow_id. A pre-mutation snapshot of the runtime is recorded for rollback. Compare with `delete_tab`, which calls a different code path that removes the tab from the full flows document via POST /flows.',
  tier: 'dangerous',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      flow_id: { type: 'string', minLength: 1 },
      confirmation_token: { type: 'string', minLength: 1 },
    },
    required: ['flow_id', 'confirmation_token'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    if (ctx.noderedClient === undefined) {
      throw new ValidationFailedError(
        'delete_flow requires an admin-api target. Call set_target first.',
        [],
      );
    }
    assertDangerousToken(input.confirmation_token, {
      operation: 'delete_flow',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      target: input.flow_id,
    });

    const { flows: runtimeFlows, rev: runtimeRev } = await ctx.flowSource.load();
    const preSnap = await ctx.snapshots.save({
      flows: runtimeFlows,
      rev: runtimeRev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: 'pre-dangerous-delete-flow',
      takenAt: ctx.clock().toISOString(),
      tags: ['pre-dangerous', 'delete-flow'],
      serverVersion: ctx.serverVersion,
    });

    await ctx.noderedClient.deleteFlow(input.flow_id);

    ctx.enrichAudit({
      mode: 'dangerous',
      snapshot_before: preSnap.id,
    });

    return {
      ok: true,
      deleted_id: input.flow_id,
      snapshot_before: preSnap.id,
    };
  },
};
