import { z } from 'zod';

import { canonicalHash } from '../../../shared/hash.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

/**
 * Output casing contract (WSB-6, 2026-06-10 layout-audit fix plan, SD6):
 * the canonical field names are snake_case — `staged_hash` feeds
 * `deploy_staged_change`'s `staged_hash` input without renaming. The
 * camelCase duplicates (`stagedHash`, `basedOnSnapshotHash`, `basedOnRev`,
 * `stagedAt`) are a deprecated dual-emit kept for one minor release;
 * removal is slated for v2.0.0 (supersession recorded in CHANGELOG.md
 * under "Unreleased (v1.4.0)").
 */
const OutputSchema = z.object({
  staged: z
    .object({
      // ---- canonical snake_case surface ----
      staged_hash: z.string(),
      based_on_snapshot_hash: z.string(),
      based_on_rev: z.string().nullable(),
      staged_at: z.string(),
      actor: z.string(),
      reason: z.string(),
      /**
       * Session id of the agent process that staged this change
       * (`FLOWOTTER_SESSION_ID` env var, else `pid-<pid>`). Null for
       * pre-v0.6.0 staged.json files that carry no agent_id.
       */
      agent_id: z.string().nullable(),
      /**
       * True when the current session can deploy/discard this stage without
       * `force_takeover` — i.e. the stage's agent_id matches this process's
       * session id, or the stage predates agent_id tagging (back-compat,
       * mirrors deploy_staged_change's ownership check).
       */
      owned_by_current_session: z.boolean(),
      /**
       * True when staged_hash is byte-identical to the current runtime flows
       * — the stage carries no undeployed work and the next author op will
       * auto-clear it (`staging/auto-cleared-stale-stage`). Null when the
       * runtime could not be read (unreachable or no target configured).
       */
      stale: z.boolean().nullable(),
      // ---- legacy camelCase dual-emit (DEPRECATED, removal v2.0.0) ----
      stagedHash: z.string(),
      basedOnSnapshotHash: z.string(),
      basedOnRev: z.string().nullable(),
      stagedAt: z.string(),
    })
    .nullable(),
});
type Output = z.infer<typeof OutputSchema>;

export const getStagedChangeTool: Tool<Input, Output> = {
  name: 'get_staged_change',
  description:
    'Returns metadata for the current staged change (or null if none). Canonical fields are snake_case — `staged_hash` feeds deploy_staged_change without renaming. Also reports `agent_id`, `owned_by_current_session` (false means deploy/discard needs force_takeover), and `stale` (staged bytes already match the runtime; the next author op auto-clears it). The camelCase duplicates (stagedHash, …) are deprecated and slated for removal in v2.0.0. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    const staged = await ctx.staging.read();
    if (!staged) return { staged: null };
    let stale: boolean | null = null;
    try {
      const { flows } = await ctx.flowSource.load();
      stale = staged.stagedHash === canonicalHash(flows);
    } catch {
      // Runtime unreachable or no target configured — staleness is
      // undeterminable. The staging slot itself is local, so the rest of
      // the payload is still served; stale stays null.
    }
    return {
      staged: {
        staged_hash: staged.stagedHash,
        based_on_snapshot_hash: staged.basedOnSnapshotHash,
        based_on_rev: staged.basedOnRev,
        staged_at: staged.stagedAt,
        actor: staged.actor,
        reason: staged.reason,
        agent_id: staged.agent_id ?? null,
        owned_by_current_session: staged.agent_id === undefined || staged.agent_id === ctx.agentId,
        stale,
        stagedHash: staged.stagedHash,
        basedOnSnapshotHash: staged.basedOnSnapshotHash,
        basedOnRev: staged.basedOnRev,
        stagedAt: staged.stagedAt,
      },
    };
  },
};
