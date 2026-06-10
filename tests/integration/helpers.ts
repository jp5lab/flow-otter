import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildContainer } from '../../src/server/container.js';
import { ALL_TOOLS } from '../../src/server/index.js';
import { buildRegistry, type ToolRegistry } from '../../src/server/tools/register.js';
import type { Container } from '../../src/server/container.js';

export interface TestRig {
  container: Container;
  registry: ToolRegistry;
  cleanup: () => Promise<void>;
}

export async function buildIntegrationRig(extraEnv: Record<string, string> = {}): Promise<TestRig> {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'nrmcp-int-'));
  const env = {
    ...process.env,
    NODE_RED_BASE_URL: process.env['NODE_RED_BASE_URL'] ?? 'http://localhost:1880',
    FLOW_SOURCE: 'admin-api',
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_DEPLOY_TOOLS: 'true',
    READ_ONLY_MODE: 'false',
    ALLOWED_DEPLOYMENT_MODES: 'nodes,flows,full',
    SNAPSHOT_DIR: path.join(tmpRoot, 'snapshots'),
    STAGING_DIR: path.join(tmpRoot, 'staging'),
    AUDIT_LOG_PATH: path.join(tmpRoot, 'audit.jsonl'),
    LOG_LEVEL: 'warn',
    ENVIRONMENT_NAME: 'integration',
    ACTOR_NAME: 'integration-test',
    ...extraEnv,
  };

  const container = buildContainer({ env, serverVersion: '0.1.0-test' });
  const registry = buildRegistry(container, ALL_TOOLS);
  // The integration suite exercises the FULL tool surface, including the
  // specialist add_*_node tools that v1.3.0 moved into the non-default
  // `author_specialists` toolset. Enable it the same way an agent would
  // (via the toolset mechanism), so registry.find() resolves them.
  registry.enableToolset('author_specialists');

  return {
    container,
    registry,
    cleanup: async () => {
      await rm(tmpRoot, { recursive: true, force: true });
    },
  };
}

export async function callTool(
  registry: ToolRegistry,
  container: Container,
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool = registry.find(name);
  if (!tool) throw new Error(`Tool '${name}' not in registry (likely tier-disabled).`);
  return tool.invoke(input, container);
}
