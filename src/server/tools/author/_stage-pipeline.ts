import type { FlowsJson } from '../../../shared/flows-json.js';
import { canonicalHash } from '../../../shared/hash.js';
import { compile } from '../../../toolkit/authoring/compile.js';
import { decompile } from '../../../toolkit/authoring/decompile.js';
import type { AuthoringSpec } from '../../../toolkit/authoring/types.js';
import { diffFlows, summarizeDiff } from '../../../toolkit/diff/semantic.js';
import { lintFlows } from '../../../toolkit/lint/flows-lint.js';
import { runValidators } from '../../../toolkit/validate/index.js';
import { enforceMaxFlowSize, enforceNodeTypePolicy } from '../../policy/flow-policy.js';
import { ValidationFailedError, type ToolContext } from '../_tool.js';

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
  /** The compiled flows.json after the op was applied. Tools can use it for op-specific output enrichment (e.g. findNewNodeId). */
  readonly compiledFlows: FlowsJson;
}

/**
 * Shared staging pipeline for author-tier tools.
 *
 * Handles the boilerplate every author tool repeats:
 *   load → decompile → op → compile → validate → lint → diff → stage → audit-enrich
 *
 * Caller supplies:
 * - `op`: a pure function taking the prior spec + prior flows and returning
 *   the next spec plus any op-specific `extras` the caller wants to surface
 *   in the final tool result.
 * - `buildOutput`: combines the common `StageBase` with `extras` into the
 *   tool's typed output.
 *
 * Errors during op / compile / validation propagate as ValidationFailedError.
 */
export async function runStagedAuthorOp<TExtras, TOutput>(
  ctx: ToolContext,
  input: AuthorOpInput,
  op: (priorSpec: AuthoringSpec, priorFlows: FlowsJson) => AuthorOpResult<TExtras>,
  buildOutput: (base: StageBase, extras: TExtras) => TOutput,
): Promise<TOutput> {
  const { flows: priorFlows, rev: priorRev } = await ctx.flowSource.load();
  const priorHash = canonicalHash(priorFlows);

  const priorSpec = decompile(priorFlows);
  const { nextSpec, extras } = op(priorSpec, priorFlows);

  const compiled = compile(nextSpec, { prior: priorFlows });

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
      `${input.toolName} produced flows with ${lintReport.errors.length} validation error(s).`,
      lintReport.errors,
    );
  }
  // Surface compile-time authoring losses (unresolved wires / group refs /
  // group members / widget anchors) so agents see them in the stage output
  // and can fix the spec instead of discovering missing wires post-deploy.
  const diagnostics = [
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
  ];

  const diff = diffFlows(priorFlows, compiled.flows);
  const diffSummary = summarizeDiff(diff);
  const stagedAt = ctx.clock().toISOString();

  await ctx.staging.write({
    flows: compiled.flows,
    basedOnSnapshotHash: priorHash,
    basedOnRev: priorRev,
    stagedHash: compiled.hash,
    stagedAt,
    actor: ctx.config.ACTOR_NAME,
    agent_id: ctx.agentId,
    reason: input.reason ?? input.toolName,
  });

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

  const base: StageBase = {
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
    compiledFlows: compiled.flows,
  };

  return buildOutput(base, extras);
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
