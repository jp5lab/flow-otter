import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContainer } from '../../../../../src/server/container.js';
import type { ToolContext } from '../../../../../src/server/tools/_tool.js';
import { planFlowTool } from '../../../../../src/server/tools/author/plan-flow.js';
import { readPlan } from '../../../../../src/toolkit/staging/plan-record.js';

let ctx: ToolContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plan-flow-'));
  const container = buildContainer({
    serverVersion: '0.0.0-test',
    clock: (): Date => new Date('2026-05-01T00:00:00.000Z'),
    env: {
      FLOW_SOURCE: 'file',
      FLOW_FILE_PATH: path.join(root, 'flows.json'),
      SNAPSHOT_DIR: path.join(root, 'snapshots'),
      STAGING_DIR: path.join(root, 'staging'),
      AUDIT_LOG_PATH: path.join(root, 'audit.jsonl'),
      ENVIRONMENT_NAME: 'unit',
      ACTOR_NAME: 'unit-test',
      LOG_LEVEL: 'silent',
    },
  });
  ctx = { ...container, enrichAudit: () => undefined, container };
  cleanup = async () => rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await cleanup();
});

describe('plan_flow', () => {
  it('returns manual layout guidance instead of implying a callable auto-layout tool', async () => {
    const out = await planFlowTool.handler(
      {
        goal: 'Build a grouped telemetry flow',
        stages: [
          {
            name: 'ingest',
            purpose: 'Receive messages',
            estimated_nodes: 4,
            organization: 'group',
            organization_rationale: 'Input nodes share one visual section',
          },
          {
            name: 'display',
            purpose: 'Show operator values',
            estimated_nodes: 30,
            organization: 'inline',
            organization_rationale: 'Single tab dashboard support logic',
            lane: 'indicate',
          },
        ],
      },
      ctx,
    );

    expect(out.layout_strategy).toBe('manual');
    expect(out.layout_rationale).toContain('Auto-layout is not exposed');
    expect(out.spatial_scaffold.grid).toBe(20);
    expect(out.spatial_scaffold.pitch).toBe(200);
    expect(out.spatial_scaffold.stages[1]?.lane).toBe('indicate');
    expect(out.next_actions).toContain(
      'Refine layout with explicit positions, move_node, and add_group geometry.',
    );
    expect(() => planFlowTool.outputZod?.parse(out)).not.toThrow();
    const stored = await readPlan(ctx.config.STAGING_DIR);
    expect(stored?.layout_strategy).toBe('manual');
    expect(stored?.schema_version).toBe(2);
    if (stored?.schema_version === 2) {
      expect(stored.spatial_scaffold).toEqual(out.spatial_scaffold);
      expect(stored.stages[1]?.lane).toBe('indicate');
    }
  });
});
