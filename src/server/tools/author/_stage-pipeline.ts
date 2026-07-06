import type { FlowsJson } from '../../../shared/flows-json.js';
import { canonicalHash } from '../../../shared/hash.js';
import { compile, type CompileIdTombstone } from '../../../toolkit/authoring/compile.js';
import { decompile } from '../../../toolkit/authoring/decompile.js';
import type { AuthoringSpec } from '../../../toolkit/authoring/types.js';
import { diffFlows, summarizeDiff } from '../../../toolkit/diff/semantic.js';
import { lintFlows } from '../../../toolkit/lint/flows-lint.js';
import { runValidators } from '../../../toolkit/validate/index.js';
import { enforceMaxFlowSize, enforceNodeTypePolicy } from '../../policy/flow-policy.js';
import { ToolBlockedError, ValidationFailedError, type ToolContext } from '../_tool.js';

import { buildStageRenderEnrichment, type StageRender } from './_stage-render.js';

export interface AuthorOpInput {
  /** Tool name — used in the audit `reason` and error messages. */
  readonly toolName: string;
  /** Audit `reason` string. Defaults to `toolName`. */
  readonly reason?: string;
}

export interface AuthorOpResult<TExtras> {
  readonly nextSpec: AuthoringSpec;
  readonly extras: TExtras;
}

export interface StageBase {
  readonly ok: true;
  readonly staged_hash: string;
  readonly based_on_snapshot_hash: string;
  readonly based_on_rev: string | null;
  readonly diff_summary: {
    readonly nodes_added: number;
    readonly nodes_removed: number;
    readonly nodes_modified: number;
    readonly wires_added: number;
    readonly wires_removed: number;
  };
  readonly diagnostics: ReadonlyArray<{
    severity: 'error' | 'warning' | 'info';
    rule: string;
    message: string;
    nodeId?: string;
    tabId?: string;
    context?: Record<string, unknown>;
  }>;
  /**
   * REND-8 before/after render paths for every touched tab (SVG always, PNG
   * when the rasterizer imports), or null when render enrichment failed.
   * Output-only — produced strictly after `staging.write`, never part of the
   * staged bytes.
   */
  readonly render: StageRender | null;
  /** The compiled flows.json after the op was applied. Tools can use it for op-specific output enrichment (e.g. findNewNodeId). */
  readonly compiledFlows: FlowsJson;
}

/**
 * The runtime baseline a stage is computed against: the flows loaded by the
 * pipeline's SINGLE `flowSource.load()`, their canonical hash, and the
 * Node-RED revision. `based_on_snapshot_hash` is always `hash` — the drift
 * check at deploy time compares against exactly this load.
 */
export interface StagePrior {
  readonly flows: FlowsJson;
  readonly hash: string;
  readonly rev: string | null;
}

export interface StageMeta {
  /** Tool name — used in the audit `reason` and error messages. */
  readonly toolName: string;
  /** Audit `reason` string. Defaults to `toolName`. */
  readonly reason?: string;
  /**
   * WSB-3's `staging/auto-cleared-stale-stage` info diagnostic, produced by
   * the pending-stage guard at pipeline start. Threaded here so it is
   * PREPENDED to the assembled stage-output diagnostics.
   */
  readonly autoClearDiagnostic?: StageBase['diagnostics'][number];
  /** Batch-only ID tombstones for remove-then-readd equivalence. */
  readonly idTombstones?: readonly CompileIdTombstone[];
  /** Validate/diff without writing the staging slot or render sidecar. */
  readonly dryRun?: boolean;
}

export interface PendingStageGuardResult {
  readonly autoClearDiagnostic?: StageBase['diagnostics'][number];
  readonly amended: boolean;
}

export const STAGED_AUTHOR_TOOL_LIFECYCLE_SENTENCE =
  'Stages into the single staging slot: if a staged change is already pending, deploy_staged_change or discard_staged_change it first — staging over it is refused.';

export function withStagedAuthorToolDescription(description: string): string {
  return `${description} ${STAGED_AUTHOR_TOOL_LIFECYCLE_SENTENCE}`;
}

export async function guardPendingStageForAuthorOp(
  ctx: ToolContext,
  input: AuthorOpInput & { readonly amendOf?: string },
  priorHash: string,
): Promise<PendingStageGuardResult> {
  const pending = await ctx.staging.read();
  if (pending === null) {
    if (input.amendOf !== undefined) {
      throw new ToolBlockedError(
        `No staged change is pending to amend; amend_of '${input.amendOf}' did not match a current staged_hash.`,
      );
    }
    return { amended: false };
  }

  const otherAgent =
    pending.agent_id !== undefined && pending.agent_id !== ctx.agentId
      ? ` by a DIFFERENT agent process ('${pending.agent_id}')`
      : '';

  if (input.amendOf !== undefined && input.amendOf === pending.stagedHash) {
    return { amended: true };
  }

  if (pending.stagedHash === priorHash && input.amendOf === undefined) {
    await ctx.staging.clear();
    return {
      amended: false,
      autoClearDiagnostic: {
        severity: 'info',
        rule: 'staging/auto-cleared-stale-stage',
        message:
          `Auto-cleared a stale staged change (reason '${pending.reason}', staged at ${pending.stagedAt}${otherAgent}): ` +
          `its staged_hash ${pending.stagedHash.slice(0, 12)}… is byte-identical to the current runtime flows, so it contained no undeployed work.`,
      },
    };
  }

  throw new ToolBlockedError(
    `A staged change is already pending deploy (reason '${pending.reason}', staged_hash ${pending.stagedHash.slice(0, 12)}…, staged at ${pending.stagedAt}${otherAgent}). ` +
      `Staging '${input.toolName}' now would silently discard it. Deploy it first (deploy_staged_change) or discard it ` +
      `(discard_staged_change — pass force_takeover: true if it was staged by a different agent process).`,
  );
}

/**
 * Shared staging pipeline for author-tier tools.
 *
 * Handles the boilerplate every author tool repeats:
 *   load → pending-guard → decompile → op → [compileValidateAndStage tail]
 *
 * Caller supplies:
 * - `op`: a function (sync or async) taking the prior spec + prior flows and
 *   returning the next spec plus any op-specific `extras` the caller wants
 *   to surface in the final tool result.
 * - `buildOutput`: combines the common `StageBase` with `extras` into the
 *   tool's typed output.
 *
 * Errors during op / compile / validation propagate as ValidationFailedError.
 */
export async function runStagedAuthorOp<TExtras, TOutput>(
  ctx: ToolContext,
  input: AuthorOpInput,
  op: (
    priorSpec: AuthoringSpec,
    priorFlows: FlowsJson,
  ) => AuthorOpResult<TExtras> | Promise<AuthorOpResult<TExtras>>,
  buildOutput: (base: StageBase, extras: TExtras) => TOutput,
): Promise<TOutput> {
  // Single runtime load, hoisted above the pending-stage check so the
  // stale-stage auto-clear below can compare the pending hash against the
  // live runtime.
  const { flows: priorFlows, rev: priorRev } = await ctx.flowSource.load();
  const priorHash = canonicalHash(priorFlows);

  // Each op stages against the RUNTIME, so staging over an undeployed change
  // would silently discard it (verified live in the 2026-06-10 eval campaign).
  // Refuse instead — the agent must deploy or discard the pending stage first.
  // EXCEPTION (WSB-3, e2 restart friction): a pending stage byte-identical to
  // the current runtime flows carries no undeployed work, so clearing it is
  // information-lossless by construction — auto-clear it regardless of which
  // agent process staged it and proceed. This can never mask drift: it fires
  // only on byte-equality with the runtime the drift check compares against.
  const { autoClearDiagnostic } = await guardPendingStageForAuthorOp(ctx, input, priorHash);

  const priorSpec = decompile(priorFlows);
  const { nextSpec, extras } = await op(priorSpec, priorFlows);

  const base = await compileValidateAndStage(
    ctx,
    { flows: priorFlows, hash: priorHash, rev: priorRev },
    nextSpec,
    {
      toolName: input.toolName,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(autoClearDiagnostic !== undefined ? { autoClearDiagnostic } : {}),
    },
  );

  return buildOutput(base, extras);
}

/**
 * The shared pipeline tail: ONE compile → no-op refusal → policy → validate →
 * lint → diff → ONE staging.write → render enrichment (REND-8, output-only) →
 * audit-enrich → StageBase.
 *
 * Extracted (WSB-5-PR1) so per-op tools (via `runStagedAuthorOp`) and the
 * `stage_changes` atomic batch (WSB-5 PR-2/3, which folds its ops into one
 * `nextSpec` first) share a single safety choke point. Callers own the steps
 * BEFORE this tail: the single `flowSource.load()` that produced `prior`, the
 * pending-stage guard + auto-clear, and decompile/op application.
 *
 * Invariants (pinned by the stage-pipeline suites):
 * - `staged_hash` is the canonical hash of the compiled flows — byte-identity
 *   holds for identical (prior, nextSpec) inputs.
 * - `based_on_snapshot_hash` = `prior.hash` (the single-load runtime baseline).
 * - The no-op refusal is the FIRST check after compile; nothing is written.
 * - Lint errors abort before anything is written (single-slot untouched).
 */
export async function compileValidateAndStage(
  ctx: ToolContext,
  prior: StagePrior,
  nextSpec: AuthoringSpec,
  meta: StageMeta,
): Promise<StageBase> {
  const { flows: priorFlows, hash: priorHash, rev: priorRev } = prior;
  const autoClearDiagnostic = meta.autoClearDiagnostic;

  const compiled = compile(nextSpec, {
    prior: priorFlows,
    ...(meta.idTombstones !== undefined ? { idTombstones: meta.idTombstones } : {}),
  });

  // NO-OP REFUSAL (WSB-3, e1 poison cascade): a compiled result byte-identical
  // to the runtime means the op changed nothing — staging it would only arm a
  // no-change deploy for REQUIRE_DIFF_BEFORE_DEPLOY to refuse later. Refuse at
  // stage time instead; nothing is written to the staging slot.
  if (compiled.hash === priorHash) {
    throw new ValidationFailedError(
      `${meta.toolName} produced no change — the compiled flows are byte-identical to the current runtime flows, so nothing was staged. ` +
        `Check the object kind and key you addressed (node vs junction vs comment vs group), and check that the new values actually differ from the current ones.`,
      [],
    );
  }

  enforceMaxFlowSize(compiled.flows, ctx.config.MAX_FLOW_SIZE_BYTES);
  enforceNodeTypePolicy(
    compiled.flows,
    ctx.config.ALLOWED_NODE_TYPES,
    ctx.config.BLOCKED_NODE_TYPES,
  );

  const validateReport = runValidators(compiled.flows, {
    labelCap: ctx.config.LABEL_CAP_CHARS,
    ...(ctx.namingContract !== undefined ? { namingContract: ctx.namingContract } : {}),
  });
  const lintReport = lintFlows(compiled.flows, {
    labelCap: ctx.config.LABEL_CAP_CHARS,
    canvasMaxX: ctx.config.CANVAS_MAX_X,
    canvasMaxY: ctx.config.CANVAS_MAX_Y,
    ...(ctx.namingContract !== undefined ? { namingContract: ctx.namingContract } : {}),
  });
  if (lintReport.hasErrors) {
    throw new ValidationFailedError(
      `${meta.toolName} produced flows with ${lintReport.errors.length} validation error(s).`,
      lintReport.errors,
    );
  }
  // Surface compile-time authoring losses (unresolved wires / group refs /
  // group members / widget anchors) so agents see them in the stage output
  // and can fix the spec instead of discovering missing wires post-deploy.
  // The validator and lint rule sets overlap (e.g. on-grid) — dedup identical
  // diagnostics so the agent doesn't see the same finding twice.
  const seenDiagnostics = new Set<string>();
  const diagnostics = [
    ...(autoClearDiagnostic !== undefined ? [autoClearDiagnostic] : []),
    ...compiled.diagnostics.map((d) => ({
      severity: d.severity,
      rule: d.rule,
      message: d.message,
      ...(d.nodeKey !== undefined ? { nodeId: d.nodeKey } : {}),
      ...(d.tabId !== undefined ? { tabId: d.tabId } : {}),
      ...(d.context !== undefined ? { context: d.context } : {}),
    })),
    ...validateReport.diagnostics,
    ...lintReport.diagnostics,
  ].filter((d) => {
    const key = `${d.severity}|${d.rule}|${d.nodeId ?? ''}|${d.tabId ?? ''}|${d.message}`;
    if (seenDiagnostics.has(key)) return false;
    seenDiagnostics.add(key);
    return true;
  });

  const diff = diffFlows(priorFlows, compiled.flows);
  const diffSummary = summarizeDiff(diff);
  const stagedAt = ctx.clock().toISOString();

  let render: StageRender | null = null;
  if (meta.dryRun !== true) {
    await ctx.staging.write({
      flows: compiled.flows,
      basedOnSnapshotHash: priorHash,
      basedOnRev: priorRev,
      stagedHash: compiled.hash,
      stagedAt,
      actor: ctx.config.ACTOR_NAME,
      agent_id: ctx.agentId,
      reason: meta.reason ?? meta.toolName,
    });

    // ── REND-8: stage-output enrichment ───────────────────────────────────────
    // Output-only enrichment (before/after render paths) — strictly AFTER
    // staging.write so it can never change the staged bytes, staged_hash,
    // based_on_snapshot_hash, the single-slot contract, or drift refusal.
    // Enrichment failures never fail the stage (`render: null` on the output).
    render = await buildStageRenderEnrichment(ctx, priorFlows, compiled.flows, compiled.hash);
  }

  const diffSummaryOut = {
    nodes_added: diffSummary.nodes_added,
    nodes_removed: diffSummary.nodes_removed,
    nodes_modified: diffSummary.nodes_modified,
    wires_added: diffSummary.wires_added,
    wires_removed: diffSummary.wires_removed,
  };

  ctx.enrichAudit({
    mode: 'stage',
    diff_summary: diffSummaryOut,
  });

  return {
    ok: true,
    staged_hash: compiled.hash,
    based_on_snapshot_hash: priorHash,
    based_on_rev: priorRev,
    diff_summary: diffSummaryOut,
    diagnostics: diagnostics.map((d) => ({
      severity: d.severity,
      rule: d.rule,
      message: d.message,
      ...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
      ...(d.tabId !== undefined ? { tabId: d.tabId } : {}),
      ...(d.context !== undefined ? { context: d.context } : {}),
    })),
    render,
    compiledFlows: compiled.flows,
  };
}

/**
 * Resolve a tab reference (either a Node-RED tab ID or an `_authoringKey`)
 * to the authoring key the AuthoringSpec uses. Author tools call this with
 * the priorFlows handed to their op so users can pass whichever form they
 * have — `list_flows` exposes both. Returns undefined when neither matches.
 */
export function resolveTabId(priorFlows: FlowsJson, tabIdOrKey: string): string | undefined {
  for (const node of priorFlows) {
    if ((node as { type?: string }).type !== 'tab') continue;
    const ext = (node as Record<string, unknown>)['_authoringKey'];
    const authoringKey = typeof ext === 'string' ? ext : node.id;
    if (node.id === tabIdOrKey || authoringKey === tabIdOrKey) {
      return authoringKey;
    }
  }
  return undefined;
}

/**
 * Find the Node-RED id of a node by its authoring key, on a specific tab.
 * Used by tools that surface `added_node_id` etc. in their output.
 */
export function findNewNodeId(
  flows: FlowsJson,
  tabId: string,
  authoringKey: string,
): string | undefined {
  for (const n of flows) {
    if ((n as { z?: string }).z !== tabId) continue;
    const ext = (n as Record<string, unknown>)['_authoringKey'];
    if (ext === authoringKey) return n.id;
  }
  return undefined;
}

/**
 * Resolve a node's authoring key from its Node-RED id. If the node has an
 * `_authoringKey` extension property, return it; otherwise fall back to the id
 * (Node-RED-editor-authored nodes have no authoring key — the id IS the key).
 */
export function resolveAuthoringKey(flows: FlowsJson, nodeId: string): string | undefined {
  const found = flows.find((n) => n.id === nodeId);
  if (!found) return undefined;
  const ext = (found as Record<string, unknown>)['_authoringKey'];
  return typeof ext === 'string' ? ext : nodeId;
}
