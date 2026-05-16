import { z } from 'zod';

import {
  ALL_DEPLOY_MODES,
  DEFAULT_DEPLOY_MODE,
  isDeployMode,
} from '../../../adapters/nodered/deploy.js';
import type { DeployMode } from '../../../shared/flow-source.js';
import { FlowsJsonSchema, type FlowsJson } from '../../../shared/flows-json.js';
import { canonicalHash } from '../../../shared/hash.js';
import { enforceMaxFlowSize, enforceNodeTypePolicy } from '../../policy/flow-policy.js';
import { type Tool, ValidationFailedError } from '../_tool.js';

import { assertDangerousToken, requireAllowedDeployMode } from './_confirmation.js';

const InputSchema = z
  .object({
    flows: z.unknown(),
    confirmation_token: z.string().min(1),
    deploy_mode: z.enum(ALL_DEPLOY_MODES as unknown as [string, ...string[]]).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  ok: z.boolean(),
  replaced_hash: z.string(),
  previous_hash: z.string(),
  deployment_mode: z.enum(['full', 'nodes', 'flows', 'reload']),
  rev_before: z.string().nullable(),
  rev_after: z.string().nullable(),
  snapshot_before: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const replaceFlowsTool: Tool<Input, Output> = {
  name: 'replace_flows',
  description:
    'Dangerous: replaces the entire Node-RED flows document with caller-supplied flows. Requires ENABLE_DANGEROUS_TOOLS and a prepare_dangerous_operation token scoped to the replacement hash.',
  tier: 'dangerous',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      flows: { type: 'array' },
      confirmation_token: { type: 'string', minLength: 1 },
      deploy_mode: { type: 'string', enum: ALL_DEPLOY_MODES as unknown as string[] },
    },
    required: ['flows', 'confirmation_token'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const parsed = FlowsJsonSchema.safeParse(input.flows);
    if (!parsed.success) {
      throw new ValidationFailedError(
        'replace_flows input did not parse as flows.json.',
        parsed.error.issues,
      );
    }
    const replacement: FlowsJson = parsed.data;
    enforceMaxFlowSize(replacement, ctx.config.MAX_FLOW_SIZE_BYTES);
    enforceNodeTypePolicy(
      replacement,
      ctx.config.ALLOWED_NODE_TYPES,
      ctx.config.BLOCKED_NODE_TYPES,
    );
    const replacementHash = canonicalHash(replacement);
    assertDangerousToken(input.confirmation_token, {
      operation: 'replace_flows',
      environment: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      flowsHash: replacementHash,
    });

    const deployMode: DeployMode = isDeployMode(input.deploy_mode)
      ? input.deploy_mode
      : DEFAULT_DEPLOY_MODE;
    requireAllowedDeployMode(deployMode, ctx.config.ALLOWED_DEPLOYMENT_MODES);

    const { flows: runtimeFlows, rev: runtimeRev } = await ctx.flowSource.load();
    const previousHash = canonicalHash(runtimeFlows);
    const preSnap = await ctx.snapshots.save({
      flows: runtimeFlows,
      rev: runtimeRev,
      env: ctx.config.ENVIRONMENT_NAME,
      actor: ctx.config.ACTOR_NAME,
      reason: 'pre-dangerous-replace-flows',
      takenAt: ctx.clock().toISOString(),
      tags: ['pre-dangerous', 'replace-flows'],
      serverVersion: ctx.serverVersion,
    });

    const saveOpts: { reason: string; deployMode: DeployMode; expectedRev?: string } = {
      reason: 'replace_flows',
      deployMode,
    };
    if (runtimeRev !== null) saveOpts.expectedRev = runtimeRev;
    const { rev: newRev } = await ctx.flowSource.save(replacement, saveOpts);

    ctx.enrichAudit({
      mode: 'dangerous',
      snapshot_before: preSnap.id,
      deployment_mode: deployMode,
    });

    return {
      ok: true,
      replaced_hash: replacementHash,
      previous_hash: previousHash,
      deployment_mode: deployMode,
      rev_before: runtimeRev,
      rev_after: newRev || null,
      snapshot_before: preSnap.id,
    };
  },
};
