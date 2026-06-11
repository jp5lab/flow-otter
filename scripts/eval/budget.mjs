/**
 * EVAL-1 — Budget account for MCP eval runs.
 *
 * One counter set per budgeted steps-file section. The counting rules here
 * are NORMATIVE — the budget glossary in docs/EVALUATION.md documents them
 * and the unit suite (tests/unit/scripts/eval/budget.test.ts) pins every
 * rule. Gate criteria (fix plan §1) derive friction scores from this
 * account, not from judge sympathy, so the rules must never drift silently.
 *
 * Counting rules:
 * - `mcp_calls`        — every MCP tool call the driver issues (exec/sleep
 *                        steps and harness introspection — listTools /
 *                        describe — are NOT mcp_calls).
 * - `failed`           — every MCP tool call that returned `isError` or
 *                        threw, INCLUDING expected failures (`expect.error:
 *                        true`). Honest accounting: drills that provoke
 *                        errors budget `max_failed` accordingly.
 * - `exec_steps`       — every `exec` shell step.
 * - `total_invocations`— mcp_calls + exec_steps (the S5 "total invocations
 *                        (MCP + Read/exec)" basis).
 * - `deploy_confirmations` — every elicitation answered `accept`, plus every
 *                        MCP call whose top-level args carry `confirm: true`
 *                        (the scripted-client consent path). `force: true`
 *                        does NOT count here — it counts in `force_uses`,
 *                        and gates hold `max_force: 0`.
 * - `elicitation_declines` — every elicitation answered decline/cancel.
 * - `force_uses`       — every MCP call with top-level `force: true`.
 * - `force_takeover_uses` — every MCP call with top-level
 *                        `force_takeover: true`.
 * - `oob_mutations`    — every step flagged `mutates: true` (out-of-band
 *                        runtime mutation, e.g. a direct Admin-API POST).
 */

export const COUNTER_KEYS = Object.freeze([
  'mcp_calls',
  'failed',
  'exec_steps',
  'total_invocations',
  'deploy_confirmations',
  'elicitation_declines',
  'force_uses',
  'force_takeover_uses',
  'oob_mutations',
]);

/** Budget keys accepted in a section's `budget` object → counter they bind. */
export const BUDGET_KEY_TO_COUNTER = Object.freeze({
  max_mcp_calls: 'mcp_calls',
  max_failed: 'failed',
  max_exec_steps: 'exec_steps',
  max_total_invocations: 'total_invocations',
  max_deploy_confirmations: 'deploy_confirmations',
  max_elicitation_declines: 'elicitation_declines',
  max_force: 'force_uses',
  max_force_takeover: 'force_takeover_uses',
  max_oob: 'oob_mutations',
});

export function newCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0]));
}

/**
 * Record one MCP tool call. `failed` marks isError/threw outcomes; `args`
 * is the SUBSTITUTED argument object (post-$PREV) so flag counting sees
 * what actually crossed the wire.
 */
export function countMcpCall(counters, { failed = false, args = undefined } = {}) {
  counters.mcp_calls += 1;
  counters.total_invocations += 1;
  if (failed) counters.failed += 1;
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    if (args.force === true) counters.force_uses += 1;
    if (args.force_takeover === true) counters.force_takeover_uses += 1;
    if (args.confirm === true) counters.deploy_confirmations += 1;
  }
}

/** Record one `exec` shell step. `mutates: true` marks an OOB mutation. */
export function countExecStep(counters, { mutates = false } = {}) {
  counters.exec_steps += 1;
  counters.total_invocations += 1;
  if (mutates === true) counters.oob_mutations += 1;
}

/** Record the answer the driver gave to a server elicitation request. */
export function countElicitation(counters, action) {
  if (action === 'accept') {
    counters.deploy_confirmations += 1;
  } else if (action === 'decline' || action === 'cancel') {
    counters.elicitation_declines += 1;
  } else {
    throw new Error(
      `countElicitation: unknown action '${String(action)}' (expected accept|decline|cancel).`,
    );
  }
}

/**
 * Check a counter set against a budget object. Returns an array of
 * violations `{budget_key, counter, limit, actual}` — empty means within
 * budget. `actual === limit` PASSES; `actual === limit + 1` violates.
 *
 * Unknown budget keys and non-integer/negative limits THROW: a typo'd key
 * would otherwise silently never bind, which is a gate-gaming hole.
 */
export function checkBudget(counters, budget) {
  const violations = [];
  for (const [key, limit] of Object.entries(budget ?? {})) {
    const counter = BUDGET_KEY_TO_COUNTER[key];
    if (counter === undefined) {
      throw new Error(
        `checkBudget: unknown budget key '${key}'. Known keys: ${Object.keys(
          BUDGET_KEY_TO_COUNTER,
        ).join(', ')}.`,
      );
    }
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
      throw new Error(
        `checkBudget: budget '${key}' must be a non-negative integer, got ${JSON.stringify(limit)}.`,
      );
    }
    const actual = counters[counter];
    if (actual > limit) violations.push({ budget_key: key, counter, limit, actual });
  }
  return violations;
}

/** Sum a list of counter sets into a fresh run-total counter set. */
export function sumCounters(list) {
  const total = newCounters();
  for (const counters of list) {
    for (const key of COUNTER_KEYS) total[key] += counters[key] ?? 0;
  }
  return total;
}
