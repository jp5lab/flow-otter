import { canonicalHash } from '../../../shared/hash.js';
import type { DeployMode } from '../../../shared/flow-source.js';
import { ALL_DEPLOY_MODES } from '../../../adapters/nodered/deploy.js';
import { ValidationFailedError } from '../_tool.js';

export const DANGEROUS_OPERATIONS = [
  'replace_flows',
  'delete_tab',
  'reset_runtime',
  'create_flow',
  'update_flow',
  'delete_flow',
] as const;

export type DangerousOperation = (typeof DANGEROUS_OPERATIONS)[number];

export const DANGEROUS_CONFIRMATION_TEXT = 'I understand this is destructive';

export interface DangerousTokenScope {
  readonly operation: DangerousOperation;
  readonly environment: string;
  readonly actor: string;
  readonly target?: string;
  readonly flowsHash?: string;
}

export function dangerousToken(scope: DangerousTokenScope): string {
  return canonicalHash({
    version: 1,
    operation: scope.operation,
    environment: scope.environment,
    actor: scope.actor,
    target: scope.target ?? null,
    flows_hash: scope.flowsHash ?? null,
  }).slice(0, 32);
}

export function assertDangerousToken(token: string, scope: DangerousTokenScope): void {
  const expected = dangerousToken(scope);
  if (token !== expected) {
    throw new ValidationFailedError(
      `Invalid confirmation_token for dangerous operation '${scope.operation}'.`,
      [],
    );
  }
}

export function requireAllowedDeployMode(requested: DeployMode, allowedSpec: string): void {
  const allowed = allowedSpec
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is DeployMode => (ALL_DEPLOY_MODES as readonly string[]).includes(s));
  if (!allowed.includes(requested)) {
    throw new ValidationFailedError(
      `Deploy mode '${requested}' not in ALLOWED_DEPLOYMENT_MODES (${allowedSpec}).`,
      [],
    );
  }
}
