import { z } from 'zod';

import {
  ALL_DEPLOY_MODES,
  DEFAULT_DEPLOY_MODE,
  isDeployMode,
} from '../../../adapters/nodered/deploy.js';
import type { DeployMode } from '../../../shared/flow-source.js';
import type { FlowsJson } from '../../../shared/flows-json.js';
import { canonicalHash } from '../../../shared/hash.js';
import { type Tool } from '../_tool.js';

import { assertDangerousToken, requireAllowedDeployMode } from './_confirmation.js';

const InputSchema = z
  .object({
    confirmation_token: z.string().min(1),
    deploy_mode: z.enum(ALL_DEPLOY_MODES as unknown as [string, ...string[]]).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  reset_hash: z.string(),
  previous_hash: z.string(),
  deployment_mode: z.enum(['full', 'nodes', 'flows', 'reload']),
  rev_before: z.string().nullable(),
  rev_after: z.string().nullable(),
  snapshot_before: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const resetRuntimeTool: Tool<Input, Output> = {
  name: 'reset_runtime',
  description:
    'Dangerous: replaces the runtime flows document with an empty flows array. Requires ENABLE_DANGEROUS_TOOLS and a prepare_dangerous_operation token scoped to reset_runtime.',
  tier: 'dangerous',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      confirmation_token: { type: 'string', minLength: 1 },
      deploy_mode: { type: 'string', enum: ALL_DEPLOY_MODES as unknown as string[] },
    },
    required: ['confirmation_token'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    assertDangerousToken(input.confirmation_token, {
      operation: 'reset_runtime',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
    });

    const deployMode: DeployMode = isDeployMode(input.deploy_mode)
      ? input.deploy_mode
      : DEFAULT_DEPLOY_MODE;
    requireAllowedDeployMode(deployMode, ctx.config.ALLOWED_DEPLOYMENT_MODES);

    const { flows: runtimeFlows, rev: runtimeRev } = await ctx.flowSource.load();
    const previousHash = canonicalHash(runtimeFlows);
    const resetFlows: FlowsJson = [];
    const resetHash = canonicalHash(resetFlows);
    const preSnap = await ctx.snapshots.save({
      flows: runtimeFlows,
      rev: runtimeRev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: 'pre-dangerous-reset-runtime',
      takenAt: ctx.clock().toISOString(),
      tags: ['pre-dangerous', 'reset-runtime'],
      serverVersion: ctx.serverVersion,
    });

    const saveOpts: { reason: string; deployMode: DeployMode; expectedRev?: string } = {
      reason: 'reset_runtime',
      deployMode,
    };
    if (runtimeRev !== null) saveOpts.expectedRev = runtimeRev;
    const { rev: newRev } = await ctx.flowSource.save(resetFlows, saveOpts);

    ctx.enrichAudit({
      mode: 'dangerous',
      snapshot_before: preSnap.id,
      deployment_mode: deployMode,
    });

    return {
      ok: true,
      reset_hash: resetHash,
      previous_hash: previousHash,
      deployment_mode: deployMode,
      rev_before: runtimeRev,
      rev_after: newRev || null,
      snapshot_before: preSnap.id,
    };
  },
};
