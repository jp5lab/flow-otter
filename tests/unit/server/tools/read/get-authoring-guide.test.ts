import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContainer } from '../../../../../src/server/container.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { getAuthoringGuideTool } from '../../../../../src/server/tools/read/get-authoring-guide.js';

let root: string;
let ctx: ToolContext;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'authoring-guide-'));
  const flowsPath = path.join(root, 'flows.json');
  await writeFile(flowsPath, '[]', 'utf8');
  const container = buildContainer({
    serverVersion: '0.0.0-test',
    env: {
      FLOW_SOURCE: 'file',
      FLOW_FILE_PATH: flowsPath,
      SNAPSHOT_DIR: path.join(root, 'snapshots'),
      STAGING_DIR: path.join(root, 'staging'),
      AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
      ENVIRONMENT_NAME: 'unit',
      ACTOR_NAME: 'unit-test',
      LOG_LEVEL: 'silent',
    },
  });
  ctx = { ...container, enrichAudit: () => undefined, container };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('get_authoring_guide', () => {
  it('returns the full capability catalog with the server version', async () => {
    const out = (await getAuthoringGuideTool.handler({}, ctx)) as {
      flow_otter_version?: string;
      core_node_types?: Array<{ generic_tool: string }>;
      methodology?: { phases: Array<{ tools: string[] }> };
    };

    expect(out.flow_otter_version).toBe('0.0.0-test');
    expect(out.core_node_types?.some((n) => n.generic_tool === 'add_node')).toBe(true);
    expect(out.methodology?.phases.some((p) => p.tools.includes('plan_flow'))).toBe(true);
  });

  it('filters to requested catalog categories', async () => {
    const out = (await getAuthoringGuideTool.handler(
      { categories: ['layout_conventions'] },
      ctx,
    )) as {
      core_node_types?: unknown;
      layout_conventions?: unknown[];
    };

    expect(out.layout_conventions).toHaveLength(8);
    expect(out.core_node_types).toBeUndefined();
  });
});
