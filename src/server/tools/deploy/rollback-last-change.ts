import { z } from 'zod';

import type { DeployMode } from '../../../shared/flow-source.js';
import { DEFAULT_DEPLOY_MODE } from '../../../adapters/nodered/deploy.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

const InputSchema = z
  .object({
    snapshot_id: z.string().optional(),
    deploy_mode: z.enum(['full', 'nodes', 'flows', 'reload']).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  restored_snapshot_id: z.string(),
  restored_hash: z.string(),
  pre_rollback_snapshot_id: z.string(),
  rev_after: z.string().nullable(),
});
type Output = z.infer<typeof OutputSchema>;

export const rollbackLastChangeTool: Tool<Input, Output> = {
  name: 'rollback_last_change',
  description:
    'Restores the most recent pre-deploy snapshot via the Admin API. Creates a "pre-rollback" snapshot of the current runtime first so the rollback itself is reversible.',
  tier: 'deploy',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      snapshot_id: { type: 'string' },
      deploy_mode: { type: 'string', enum: ['full', 'nodes', 'flows', 'reload'] },
    },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const target = input.snapshot_id
      ? input.snapshot_id
      : (await ctx.snapshots.latest(ctx.config.ENVIRONMENT_NAME))?.id;
    if (!target) {
      throw new ValidationFailedError(
        `No snapshot available to roll back to in env '${ctx.config.ENVIRONMENT_NAME}'.`,
        [],
      );
    }
    const targetPayload = await ctx.snapshots.load(target);

    const { flows: currentFlows, rev: currentRev } = await ctx.flowSource.load();
    const preRollback = await ctx.snapshots.save({
      flows: currentFlows,
      rev: currentRev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: `pre-rollback to ${target}`,
      takenAt: ctx.clock().toISOString(),
      tags: ['pre-rollback'],
      serverVersion: ctx.serverVersion,
    });

    const deployMode: DeployMode = input.deploy_mode ?? DEFAULT_DEPLOY_MODE;
    const { rev: newRev } = await ctx.flowSource.save(targetPayload.flows, {
      reason: 'rollback_last_change',
      deployMode,
    });

    ctx.enrichAudit({
      mode: 'rollback',
      snapshot_before: preRollback.id,
      snapshot_after: targetPayload.manifest.id,
      deployment_mode: deployMode,
    });

    return {
      ok: true,
      restored_snapshot_id: targetPayload.manifest.id,
      restored_hash: targetPayload.manifest.sha256,
      pre_rollback_snapshot_id: preRollback.id,
      rev_after: newRev || null,
    };
  },
};
