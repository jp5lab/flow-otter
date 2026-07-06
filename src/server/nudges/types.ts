/**
 * Soft-nudge / response-side guidance system.
 *
 * Nudges are advisory messages appended to tool responses when the agent
 * appears to be skipping methodology — e.g., adding the 12th node to a
 * flow without a plan_flow record. They are NEVER enforcement (the tool
 * still completes successfully); they're contextual reminders fired at the
 * moment the methodology decision matters.
 *
 * Anthropic's `writing-tools-for-agents` calls this out as more effective
 * than tool descriptions alone, because the reminder fires when the agent
 * is mid-structural-decision rather than at session start when methodology
 * is abstract.
 *
 * Design constraints:
 * - Nudges MUST be defensive: a bug in a nudge's check function must not
 *   break the tool call. Errors during evaluation are logged and ignored.
 * - The NudgeContext is built lazily — most nudges only inspect part of it,
 *   and building it requires cheap (~ms) I/O against the staging directory.
 * - Output augmentation: when nudges fire, the tool's return value gains a
 *   `_guidance: string[]` field. Tools that return primitives are skipped
 *   (no place to attach the array).
 */

import type { LayoutScoreSummary } from '../../toolkit/lint/flows-lint.js';

export interface NudgeStagingInfo {
  /** Total nodes across all tabs in the staged spec. 0 if no stage. */
  readonly node_count: number;
  /** True if a plan.json exists alongside the staged change. */
  readonly has_plan: boolean;
  /** Set when has_plan is true. */
  readonly plan_id?: string;
  /** Hash of the current staged change (for cross-referencing). */
  readonly staged_hash?: string;
  /** Best-effort layout score for the current staged change. */
  readonly layout?: LayoutScoreSummary;
}

export interface NudgeFlowInfo {
  readonly has_dashboard_v1: boolean;
  readonly has_dashboard_v2: boolean;
}

export interface NudgeContext {
  /** Name of the tool currently being invoked. */
  readonly tool_name: string;
  /** Tier of the tool currently being invoked. */
  readonly tier: string;
  /** Lazily-fetched staging info. */
  readonly staging: NudgeStagingInfo;
  /** Lazily-fetched flow inventory (e.g., dashboard mixing detection). */
  readonly flow: NudgeFlowInfo;
}

export interface Nudge {
  readonly id: string;
  readonly description: string;
  /**
   * Filter — return true if this nudge applies to the given tool call.
   * Receives the tool name and tier; most nudges check by tool name.
   */
  readonly applies: (toolName: string, tier: string) => boolean;
  /**
   * Evaluate the nudge against the live context. Return a non-empty string
   * to emit guidance; return null to stay silent.
   *
   * MUST be defensive — any throw is caught by the evaluator and treated
   * as "no guidance for this nudge."
   */
  readonly check: (ctx: NudgeContext, args: unknown, result: unknown) => string | null;
}
