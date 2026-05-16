import { z } from 'zod';

import { canonicalHash } from '../../../shared/hash.js';
import { DriftError, RevMismatchError } from '../../../adapters/nodered/errors.js';
import {
  ALL_DEPLOY_MODES,
  DEFAULT_DEPLOY_MODE,
  isDeployMode,
} from '../../../adapters/nodered/deploy.js';
import type { DeployMode } from '../../../shared/flow-source.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

const InputSchema = z
  .object({
    staged_hash: z.string().min(1),
    deploy_mode: z.enum(ALL_DEPLOY_MODES as unknown as [string, ...string[]]).optional(),
    force: z.boolean().optional(),
    /**
     * When true, deploy even if the staged change was authored by a
     * different agent process (`staged.agent_id !== ctx.agentId`). Default
     * false. Use when intentionally picking up another session's stage.
     */
    force_takeover: z.boolean().optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  deployed_hash: z.string(),
  deployment_mode: z.enum(['full', 'nodes', 'flows', 'reload']),
  rev_before: z.string().nullable(),
  rev_after: z.string().nullable(),
  snapshot_before: z.string(),
  forced: z.boolean(),
  takeover: z.boolean(),
  /**
   * True when the initial save threw a transient error (rev mismatch or
   * timeout-style error) AND the post-deploy verify-by-hash discovered the
   * runtime already matched our staged content. Indicates the runtime DID
   * get updated despite the surface-level error.
   */
  recovered_from_partial: z.boolean(),
  /**
   * True when a rev-mismatch 409 was retried once after re-fetching the
   * current rev. (Drift was unchanged — equal hash to staged.basedOnSnapshotHash.)
   */
  retried_on_rev_mismatch: z.boolean(),
});
type Output = z.infer<typeof OutputSchema>;

export const deployStagedChangeTool: Tool<Input, Output> = {
  name: 'deploy_staged_change',
  description:
    'Deploys the currently-staged change to the runtime. Snapshots the prior runtime state first, runs a drift check (refuses on hash mismatch unless force=true), and posts via Admin API with the requested deployment mode (default: nodes). Records a redacted audit event.',
  tier: 'deploy',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      staged_hash: { type: 'string', minLength: 1 },
      deploy_mode: { type: 'string', enum: ALL_DEPLOY_MODES as unknown as string[] },
      force: { type: 'boolean' },
      force_takeover: {
        type: 'boolean',
        description:
          'Deploy a stage authored by a different agent process. Default false; use only when intentionally picking up another session’s stage.',
      },
    },
    required: ['staged_hash'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const staged = await ctx.staging.read();
    if (!staged) {
      throw new ValidationFailedError('No staged change to deploy.', []);
    }
    if (staged.stagedHash !== input.staged_hash) {
      throw new ValidationFailedError(
        `Staged hash mismatch: requested '${input.staged_hash}', staged '${staged.stagedHash}'.`,
        [],
      );
    }

    // Per-session staging guard: refuse if a different agent process staged
    // this change unless caller passed force_takeover. v0.5.0 staged.json
    // files have no agent_id — back-compat path allows them through.
    const stagedAgentId = staged.agent_id;
    const wantedTakeover = input.force_takeover === true;
    if (stagedAgentId !== undefined && stagedAgentId !== ctx.agentId && !wantedTakeover) {
      throw new ValidationFailedError(
        `Staged change was authored by a different agent process (staged.agent_id='${stagedAgentId}', current='${ctx.agentId}'). Pass force_takeover:true to deploy anyway.`,
        [],
      );
    }

    const allowedModes = parseAllowedModes(ctx.config.ALLOWED_DEPLOYMENT_MODES);
    const requestedMode: DeployMode = isDeployMode(input.deploy_mode)
      ? input.deploy_mode
      : DEFAULT_DEPLOY_MODE;
    if (!allowedModes.includes(requestedMode)) {
      throw new ValidationFailedError(
        `Deploy mode '${requestedMode}' not in ALLOWED_DEPLOYMENT_MODES (${ctx.config.ALLOWED_DEPLOYMENT_MODES}).`,
        [],
      );
    }

    const force = input.force ?? false;

    // Pre-deploy snapshot of current runtime
    const { flows: runtimeFlows, rev: runtimeRev } = await ctx.flowSource.load();
    const runtimeHash = canonicalHash(runtimeFlows);

    if (
      ctx.config.REQUIRE_DRIFT_CHECK_BEFORE_DEPLOY &&
      runtimeHash !== staged.basedOnSnapshotHash &&
      !force
    ) {
      throw new DriftError(
        staged.basedOnSnapshotHash,
        runtimeHash,
        `Runtime flows.json has drifted (hash ${runtimeHash} vs staged base ${staged.basedOnSnapshotHash}). Pass force=true to override.`,
      );
    }

    const preSnap = await ctx.snapshots.save({
      flows: runtimeFlows,
      rev: runtimeRev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: 'pre-deploy',
      takenAt: ctx.clock().toISOString(),
      tags: force ? ['pre-deploy', 'forced'] : ['pre-deploy'],
      serverVersion: ctx.serverVersion,
    });

    const saveOpts: { reason: string; deployMode: DeployMode; expectedRev?: string } = {
      reason: 'deploy_staged_change',
      deployMode: requestedMode,
    };
    if (runtimeRev !== null && !force) saveOpts.expectedRev = runtimeRev;

    let newRev: string;
    let retriedOnRevMismatch = false;
    let recoveredFromPartial = false;
    try {
      const result = await ctx.flowSource.save(staged.flows, saveOpts);
      newRev = result.rev;
    } catch (err) {
      // Rev-mismatch race: re-fetch, check if runtime hash is still our pre-deploy
      // baseline (no real drift, just a rev bump). If so, retry once with new rev.
      if (err instanceof RevMismatchError && !force) {
        const { flows: refetched, rev: refetchedRev } = await ctx.flowSource.load();
        const refetchedHash = canonicalHash(refetched);
        if (refetchedHash === runtimeHash) {
          retriedOnRevMismatch = true;
          const retryOpts: typeof saveOpts = {
            ...saveOpts,
            ...(refetchedRev !== null ? { expectedRev: refetchedRev } : {}),
          };
          const result = await ctx.flowSource.save(staged.flows, retryOpts);
          newRev = result.rev;
        } else {
          throw err;
        }
      } else {
        // Post-deploy verify-by-hash: the save may have succeeded server-side
        // but the response failed to reach us (network split, timeout). Re-fetch
        // and check whether runtime matches our staged content.
        try {
          const { flows: verifyFlows, rev: verifyRev } = await ctx.flowSource.load();
          const verifyHash = canonicalHash(verifyFlows);
          if (verifyHash === staged.stagedHash) {
            recoveredFromPartial = true;
            newRev = verifyRev ?? '';
            ctx.logger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                tool: 'deploy_staged_change',
              },
              'deploy.save() threw, but post-deploy verify-by-hash found runtime matches staged — treating as success',
            );
          } else {
            throw err;
          }
        } catch (verifyErr) {
          // Verify also failed — surface the original error.
          if (verifyErr === err) throw err;
          throw err;
        }
      }
    }

    await ctx.staging.clear();

    ctx.enrichAudit({
      mode: 'deploy',
      snapshot_before: preSnap.id,
      deployment_mode: requestedMode,
      ...(force || retriedOnRevMismatch || recoveredFromPartial ? { result: 'warning' } : {}),
    });

    return {
      ok: true,
      deployed_hash: staged.stagedHash,
      deployment_mode: requestedMode,
      rev_before: runtimeRev,
      rev_after: newRev || null,
      snapshot_before: preSnap.id,
      forced: force,
      takeover: stagedAgentId !== undefined && stagedAgentId !== ctx.agentId && wantedTakeover,
      recovered_from_partial: recoveredFromPartial,
      retried_on_rev_mismatch: retriedOnRevMismatch,
    };
  },
};

function parseAllowedModes(spec: string): DeployMode[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is DeployMode => isDeployMode(s));
}
