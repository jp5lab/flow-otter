/** Hand-written declarations for driver.mjs pure helpers (consumed by the unit suite). */

export declare const EXIT_OK: 0;
export declare const EXIT_GATE_FAIL: 1;
export declare const EXIT_ABORT: 2;

export declare class StepsFileError extends Error {}

export declare class PrevPoisonedError extends Error {
  info: Record<string, unknown>;
}

export interface NormalizedStep {
  tool?: string;
  args?: Record<string, unknown>;
  exec?: string;
  sleep?: number;
  mutates?: boolean;
  save?: string;
  maxLen?: number;
  elicitation?: 'accept' | 'decline';
  expect?: { error?: boolean; match?: string; not_match?: string };
}

export interface NormalizedSection {
  name: string;
  budget: Record<string, number> | null;
  layout_computed: boolean;
  calls: NormalizedStep[];
}

export interface NormalizedSteps {
  version: 2;
  env: Record<string, string>;
  listTools: boolean;
  describe: string[];
  sections: NormalizedSection[];
}

export interface LintViolation {
  section: string;
  step_index: number;
  tool: string;
  paths: string[];
}

export interface PrevTracker {
  record(step: string, outcome: { ok: true; data: unknown } | { ok: false; reason: string }): void;
  subst(value: unknown, stepName: string): unknown;
}

export declare function parseFlowOtterCmd(env?: Record<string, string | undefined>): {
  command: string;
  args: string[];
};
export declare function normalizeSteps(raw: unknown): NormalizedSteps;
export declare function findPositionFields(value: unknown, path?: string): string[];
export declare function lintSteps(normalized: NormalizedSteps): LintViolation[];
export declare function createPrevTracker(): PrevTracker;
