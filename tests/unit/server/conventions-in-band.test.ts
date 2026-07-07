import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContainer } from '../../../src/server/container.js';
import { SERVER_INSTRUCTIONS } from '../../../src/server/index.js';
import type { ToolContext } from '../../../src/server/tools/_tool.js';
import { planFlowTool } from '../../../src/server/tools/author/plan-flow.js';
import { selectCatalog } from '../../../src/toolkit/catalog/index.js';
import { LANE_GAP } from '../../../src/toolkit/lanes.js';
import { DEFAULT_GRID } from '../../../src/toolkit/layout/grid.js';
import {
  SPATIAL_SCAFFOLD_PITCH,
  SPATIAL_SCAFFOLD_VIEWPORT,
  SPATIAL_SCAFFOLD_VISIBLE_WIDTH,
} from '../../../src/toolkit/layout/spatial-scaffold.js';

const CRITERIA = [
  'lifecycle_left_to_right',
  'stages_visually_grouped',
  'stage_headers',
  'error_lane_below',
  'affirmative_output_on_top',
  'minimal_wire_crossings',
  'no_backward_wires',
  'grid_aligned_within_viewport',
] as const;

const RULE_IDS = [
  'layout-stage-order',
  'layout-group-overlap',
  'layout-header-presence',
  'layout-error-lane-below',
  'layout-affirmative-on-top',
  'layout-wire-crossings',
  'layout-backward-wires',
  'layout-viewport-overflow',
] as const;

let root: string;
let ctx: ToolContext;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'conventions-in-band-'));
  const container = buildContainer({
    serverVersion: '0.0.0-test',
    clock: (): Date => new Date('2026-07-06T00:00:00.000Z'),
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
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function visibleChannels(): Promise<readonly string[]> {
  const guide = selectCatalog('0.0.0-test', ['layout_conventions', 'methodology']);
  const planOutput = await planFlowTool.handler(
    {
      goal: 'Build a staged telemetry flow',
      stages: [
        {
          name: 'acquire',
          purpose: 'Read telemetry',
          estimated_nodes: 2,
          organization: 'group',
          organization_rationale: 'Input nodes share one purpose',
        },
        {
          name: 'decide',
          purpose: 'Route alarms',
          estimated_nodes: 2,
          organization: 'group',
          organization_rationale: 'Decision nodes share one stage',
        },
        {
          name: 'error',
          purpose: 'Handle failures',
          estimated_nodes: 1,
          organization: 'inline',
          organization_rationale: 'Small error branch',
          lane: 'error',
        },
      ],
    },
    ctx,
  );

  return [SERVER_INSTRUCTIONS, JSON.stringify(guide), JSON.stringify(planOutput)];
}

describe('D-7 S7 conventions in band', () => {
  it('exposes every audit criterion and scored rule id through agent-visible channels', async () => {
    const joined = (await visibleChannels()).join('\n');

    for (const criterion of CRITERIA) expect(joined).toContain(criterion);
    for (const ruleId of RULE_IDS) expect(joined).toContain(ruleId);
  });

  it('exposes every shipped and taught numeric layout constant in band', async () => {
    const joined = (await visibleChannels()).join('\n');

    expect(joined).toContain(`${DEFAULT_GRID}px`);
    expect(joined).toContain('140-220');
    expect(joined).toContain(String(SPATIAL_SCAFFOLD_PITCH));
    expect(joined).toContain(String(LANE_GAP));
    expect(joined).toContain('BELOW');
    expect(joined).toContain('port 0');
    expect(joined).toContain(String(SPATIAL_SCAFFOLD_VISIBLE_WIDTH));
    expect(joined).toContain(String(SPATIAL_SCAFFOLD_VIEWPORT.width));
    // D-5's viewport-arithmetic chrome numbers (1920 − 180 palette − 320 sidebar
    // = 1420) — asserted with their px-suffixed copy so a bare '180' elsewhere
    // (e.g. 'RFC4180' in catalog data) cannot satisfy the probe spuriously.
    expect(joined).toContain('180px palette');
    expect(joined).toContain('320px sidebar');
  });
});
