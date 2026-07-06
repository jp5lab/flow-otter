/** Hand-written declarations for score.mjs (consumed by the unit suite). */

export declare const SCORE_EPSILON: 1e-9;

export interface LintRuleScore {
  rule: string;
  score: number;
  offender_count: number;
}

export interface RuleDelta {
  rule: string;
  baseline_score: number | null;
  engine_score: number | null;
  delta: number | null;
  baseline_offender_count: number | null;
  engine_offender_count: number | null;
}

export interface ScoreRow {
  status: string;
  not_worse?: boolean;
  semantics_pass?: boolean;
}

export interface ScoreSummary {
  not_worse_rate: number;
  crashes: number;
  semantics_pass_all: boolean;
  verdict: 'PASS' | 'FAIL';
}

export declare function overallDelta(baselineOverall: number, engineOverall: number): number;
export declare function notWorse(delta: number, epsilon?: number): boolean;
export declare function ruleDeltas(
  baselineRules: readonly LintRuleScore[],
  engineRules: readonly LintRuleScore[],
): RuleDelta[];
export declare function summarizeScores(rows: readonly ScoreRow[]): ScoreSummary;
