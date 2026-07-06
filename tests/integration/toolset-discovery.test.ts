import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildContainer, type Container } from '../../src/server/container.js';
import { ALL_TOOLS } from '../../src/server/index.js';
import { buildRegistry, type ToolRegistry } from '../../src/server/tools/register.js';

import { callTool } from './helpers.js';

let root: string;
let container: Container;
let registry: ToolRegistry;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'toolset-discovery-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, '[]', 'utf8');
  container = buildContainer({
    serverVersion: '0.1.0-test',
    env: {
      FLOW_SOURCE: 'file',
      FLOW_FILE_PATH: flowsPath,
      ENABLE_WRITE_TOOLS: 'true',
      ENABLE_DEPLOY_TOOLS: 'true',
      READ_ONLY_MODE: 'false',
      SNAPSHOT_DIR: path.join(root, 'snapshots'),
      STAGING_DIR: path.join(root, 'staging'),
      AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
      LOG_LEVEL: 'warn',
      ENVIRONMENT_NAME: 'integration-toolset-discovery',
      ACTOR_NAME: 'integration-test',
    },
    clock: (): Date => new Date('2026-05-01T00:00:00.000Z'),
  });
  registry = buildRegistry(container, ALL_TOOLS);
  container.toolRegistry = registry;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('toolset discovery through the registry', () => {
  it('get_authoring_guide and list_available_toolsets expose the default surface', async () => {
    const guide = (await callTool(registry, container, 'get_authoring_guide', {
      categories: ['methodology', 'layout_conventions'],
    })) as {
      methodology: { phases: Array<{ tools: string[] }> };
      layout_conventions: unknown[];
    };
    expect(guide.methodology.phases.some((p) => p.tools.includes('plan_flow'))).toBe(true);
    expect(guide.layout_conventions).toHaveLength(8);

    const listed = (await callTool(registry, container, 'list_available_toolsets', {})) as {
      toolsets: Array<{ name: string; currently_enabled: boolean }>;
    };
    expect(listed.toolsets.find((t) => t.name === 'core')?.currently_enabled).toBe(true);
    expect(listed.toolsets.find((t) => t.name === 'author_specialists')?.currently_enabled).toBe(
      false,
    );

    const visible = registry.listTools().map((t) => t.name);
    expect(visible).toContain('plan_flow');
    expect(visible).not.toContain('add_inject_node');
  });

  it('enable_toolset makes specialist tools visible without touching flow state', async () => {
    const before = await container.flowSource.load();
    const enabled = (await callTool(registry, container, 'enable_toolset', {
      name: 'author_specialists',
    })) as {
      ok: boolean;
      toolset: string;
      already_enabled: boolean;
      added: string[];
    };

    expect(enabled).toMatchObject({
      ok: true,
      toolset: 'author_specialists',
      already_enabled: false,
    });
    expect(enabled.added).toContain('add_inject_node');
    expect(registry.listTools().map((t) => t.name)).toContain('add_inject_node');

    const after = await container.flowSource.load();
    expect(after.flows).toEqual(before.flows);
  });

  it('plan_flow records an authoring plan through the invokable tool path', async () => {
    const out = (await callTool(registry, container, 'plan_flow', {
      goal: 'Build a compact telemetry review flow',
      stages: [
        {
          name: 'ingest',
          purpose: 'Receive telemetry',
          estimated_nodes: 2,
          organization: 'inline',
          organization_rationale: 'Small entry stage',
        },
        {
          name: 'review',
          purpose: 'Show values to operators',
          estimated_nodes: 3,
          organization: 'group',
          organization_rationale: 'Display nodes share one purpose',
        },
      ],
    })) as {
      ok: boolean;
      total_estimated_nodes: number;
      layout_strategy: string;
      next_actions: string[];
    };

    expect(out.ok).toBe(true);
    expect(out.total_estimated_nodes).toBe(5);
    expect(out.layout_strategy).toBe('manual');
    expect(out.next_actions.some((a) => a.includes('deploy_staged_change'))).toBe(true);
  });
});
