import type { DeployMode } from '../../shared/flow-source.js';

export const DEPLOY_TYPE_HEADER = 'Node-RED-Deployment-Type';

export const DEFAULT_DEPLOY_MODE: DeployMode = 'nodes';

export const ALL_DEPLOY_MODES: readonly DeployMode[] = ['full', 'nodes', 'flows', 'reload'];

export function isDeployMode(value: unknown): value is DeployMode {
  return typeof value === 'string' && (ALL_DEPLOY_MODES as readonly string[]).includes(value);
}
