/** Hand-written declarations for budget.mjs (consumed by the unit suite). */

export interface Counters {
  mcp_calls: number;
  failed: number;
  exec_steps: number;
  total_invocations: number;
  deploy_confirmations: number;
  elicitation_declines: number;
  force_uses: number;
  force_takeover_uses: number;
  oob_mutations: number;
  [key: string]: number;
}

export interface BudgetViolation {
  budget_key: string;
  counter: string;
  limit: number;
  actual: number;
}

export declare const COUNTER_KEYS: readonly string[];
export declare const BUDGET_KEY_TO_COUNTER: Readonly<Record<string, string>>;

export declare function newCounters(): Counters;
export declare function countMcpCall(
  counters: Counters,
  opts?: { failed?: boolean; args?: unknown },
): void;
export declare function countExecStep(counters: Counters, opts?: { mutates?: boolean }): void;
export declare function countElicitation(counters: Counters, action: string): void;
export declare function checkBudget(
  counters: Counters,
  budget: Record<string, number> | null | undefined,
): BudgetViolation[];
export declare function sumCounters(list: readonly Counters[]): Counters;
