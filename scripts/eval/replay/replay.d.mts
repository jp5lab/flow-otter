export type ReplayScenarioKey = 'e2:1' | 'e1:1' | 'e1:2';

export interface ReplayCliOptions {
  url: string;
  scenario: 'all' | 'e1' | 'e2';
  phase: 1 | 2 | undefined;
  json: string | undefined;
  keepFlows: boolean;
  expectFail: boolean;
  noExpectFail: boolean;
}

export interface ReplayScenarioConfig {
  scenario: 'e1' | 'e2';
  phase: 1 | 2;
  label: string;
  stepsFile: string;
  baselineFixture: string;
  tabId: string;
  wiringIdentity: boolean;
  expectFailDefault: boolean;
}

export interface ReplayPostCondition {
  name: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

export const S5_DELEGATION: Readonly<{
  command: string;
  steps_file: string;
  note: string;
}>;

export const REPLAY_SCENARIOS: Readonly<Record<ReplayScenarioKey, ReplayScenarioConfig>>;

export function parseArgs(argv: string[]): ReplayCliOptions;

export function selectedScenarioKeys(opts: ReplayCliOptions): ReplayScenarioKey[];

export function parseDriverLines(stdout: string): Array<Record<string, unknown>>;

export function safetyPostConditions(lines: Array<Record<string, unknown>>): ReplayPostCondition[];

export function wiringIdentityPostCondition(args: {
  enabled: boolean;
  key: string;
  attempt: number;
  driverStatus: number;
  baselineFlows: unknown;
  finalFlows: unknown;
}): ReplayPostCondition | null;
