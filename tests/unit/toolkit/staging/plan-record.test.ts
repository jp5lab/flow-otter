import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPlan,
  planRecordPath,
  readPlan,
  writePlan,
  type PlanRecord,
  type PlanRecordV1,
  type PlanRecordV2,
} from '../../../../src/toolkit/staging/plan-record.js';
import { buildSpatialScaffold } from '../../../../src/toolkit/layout/spatial-scaffold.js';

let stagingDir: string;

beforeEach(async () => {
  stagingDir = await mkdtemp(path.join(os.tmpdir(), 'plan-record-'));
});

afterEach(async () => {
  await rm(stagingDir, { recursive: true, force: true });
});

const sampleStages: PlanRecordV2['stages'] = [
  {
    name: 'ingest',
    purpose: 'Receive MQTT messages.',
    estimated_nodes: 3,
    organization: 'inline',
    organization_rationale: 'Small ingest; no need to group.',
  },
  {
    name: 'transform',
    purpose: 'Normalize payload.',
    estimated_nodes: 4,
    organization: 'group',
    organization_rationale: 'Shared purpose; group for clarity.',
    lane: 'error',
  },
];

const sampleRecord: PlanRecordV2 = {
  schema_version: 2,
  plan_id: '01H8X7Z2VK4F5N6M7P8Q9R0S1T',
  recorded_at: '2026-05-19T12:00:00.000Z',
  actor: 'tester',
  goal: 'Build an MQTT-to-debug pipeline.',
  stages: sampleStages,
  total_estimated_nodes: 7,
  layout_strategy: 'dagre_auto',
  layout_rationale: 'Small flow; dagre is fine.',
  next_actions: ['Add nodes', 'Wire them', 'Layout and review'],
  spatial_scaffold: buildSpatialScaffold(sampleStages),
};

const v1Fixture: PlanRecordV1 = {
  schema_version: 1,
  plan_id: '01H8X7Z2VK4F5N6M7P8Q9R0S1V',
  recorded_at: '2026-05-19T12:00:00.000Z',
  actor: 'tester',
  goal: 'Build a legacy plan.',
  stages: [
    {
      name: 'legacy',
      purpose: 'Existing on-disk v1 sidecar.',
      estimated_nodes: 2,
      organization: 'inline',
      organization_rationale: 'Pre-D-6 plan record.',
    },
  ],
  total_estimated_nodes: 2,
  layout_strategy: 'manual',
  layout_rationale: 'Legacy manual plan.',
  next_actions: ['Add nodes'],
};

describe('plan-record', () => {
  it('writes and reads a plan record', async () => {
    await writePlan(stagingDir, sampleRecord);
    const round = await readPlan(stagingDir);
    expect(round).toEqual(sampleRecord);
  });

  it('accepts a raw v1 fixture for existing sidecars', async () => {
    await writeFile(planRecordPath(stagingDir), `${JSON.stringify(v1Fixture, null, 2)}\n`, 'utf8');

    const read = await readPlan(stagingDir);

    expect(read).toEqual(v1Fixture satisfies PlanRecord);
  });

  it('writePlan emits a schema_version 2 sidecar with a spatial scaffold', async () => {
    await writePlan(stagingDir, sampleRecord);

    const raw = JSON.parse(await readFile(planRecordPath(stagingDir), 'utf8')) as PlanRecord;

    expect(raw.schema_version).toBe(2);
    if (raw.schema_version === 2) {
      expect(raw.spatial_scaffold).toEqual(sampleRecord.spatial_scaffold);
      expect(raw.stages[1]?.lane).toBe('error');
    }
  });

  it('returns null when no plan present', async () => {
    expect(await readPlan(stagingDir)).toBeNull();
  });

  it('clearPlan removes the file and returns true', async () => {
    await writePlan(stagingDir, sampleRecord);
    expect(await clearPlan(stagingDir)).toBe(true);
    expect(await readPlan(stagingDir)).toBeNull();
  });

  it('clearPlan returns false when no plan present', async () => {
    expect(await clearPlan(stagingDir)).toBe(false);
  });

  it('rejects an invalid record on write', async () => {
    const bad = { ...sampleRecord, stages: [] } as PlanRecordV2;
    await expect(writePlan(stagingDir, bad)).rejects.toThrow();
  });

  it('planRecordPath returns the expected file path', () => {
    expect(planRecordPath(stagingDir)).toBe(path.join(stagingDir, 'plan.json'));
  });
});
