import { z } from 'zod';

import type { FlowsJson } from '../../../shared/flows-json.js';
import { canonicalHash } from '../../../shared/hash.js';
import { enforceMaxFlowSize, enforceNodeTypePolicy } from '../../policy/flow-policy.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { assertDangerousToken } from './_confirmation.js';

const InputSchema = z
  .object({
    flow: z.unknown(),
    confirmation_token: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  created_id: z.string(),
  snapshot_before: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const createFlowTool: Tool<Input, Output> = {
  name: 'create_flow',
  description:
    'Dangerous: creates a new Node-RED flow (tab) via the Admin API POST /flow endpoint. Bypasses staging — the runtime sees the change immediately. Requires ENABLE_DANGEROUS_TOOLS and a `prepare_dangerous_operation` token scoped to the flow body hash. A pre-mutation snapshot of the runtime is recorded for rollback.',
  tier: 'dangerous',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      flow: { type: 'object' },
      confirmation_token: { type: 'string', minLength: 1 },
    },
    required: ['flow', 'confirmation_token'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    if (ctx.noderedClient === undefined) {
      throw new ValidationFailedError(
        'create_flow requires an admin-api target. Call set_target first.',
        [],
      );
    }
    const flowAsRecord = input.flow as Record<string, unknown> | null;
    const flowNodes: FlowsJson =
      flowAsRecord !== null && Array.isArray(flowAsRecord['nodes'])
        ? (flowAsRecord['nodes'] as FlowsJson)
        : [];
    enforceMaxFlowSize(flowNodes, ctx.config.MAX_FLOW_SIZE_BYTES);
    enforceNodeTypePolicy(flowNodes, ctx.config.ALLOWED_NODE_TYPES, ctx.config.BLOCKED_NODE_TYPES);
    const flowsHash = canonicalHash(input.flow);
    const targetLabel =
      typeof input.flow === 'object' &&
      input.flow !== null &&
      typeof (input.flow as { label?: unknown }).label === 'string'
        ? (input.flow as { label: string }).label
        : '';
    assertDangerousToken(input.confirmation_token, {
      operation: 'create_flow',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      target: targetLabel,
      flowsHash,
    });

    const { flows: runtimeFlows, rev: runtimeRev } = await ctx.flowSource.load();
    const preSnap = await ctx.snapshots.save({
      flows: runtimeFlows,
      rev: runtimeRev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: 'pre-dangerous-create-flow',
      takenAt: ctx.clock().toISOString(),
      tags: ['pre-dangerous', 'create-flow'],
      serverVersion: ctx.serverVersion,
    });

    const { id: createdId } = await ctx.noderedClient.createFlow(input.flow);

    ctx.enrichAudit({
      mode: 'dangerous',
      snapshot_before: preSnap.id,
    });

    return {
      ok: true,
      created_id: createdId,
      snapshot_before: preSnap.id,
    };
  },
};
