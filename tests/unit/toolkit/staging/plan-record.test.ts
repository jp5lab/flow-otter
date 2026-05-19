import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearPlan,
  planRecordPath,
  readPlan,
  writePlan,
  type PlanRecord,
} from '../../../../src/toolkit/staging/plan-record.js';

let stagingDir: string;

beforeEach(async () => {
  stagingDir = await mkdtemp(path.join(os.tmpdir(), 'plan-record-'));
});

afterEach(async () => {
  await rm(stagingDir, { recursive: true, force: true });
});

const sampleRecord: PlanRecord = {
  schema_version: 1,
  plan_id: '01H8X7Z2VK4F5N6M7P8Q9R0S1T',
  recorded_at: '2026-05-19T12:00:00.000Z',
  actor: 'tester',
  goal: 'Build an MQTT-to-debug pipeline.',
  stages: [
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
    },
  ],
  total_estimated_nodes: 7,
  layout_strategy: 'dagre_auto',
  layout_rationale: 'Small flow; dagre is fine.',
  next_actions: ['Add nodes', 'Wire them', 'Layout and review'],
};

describe('plan-record', () => {
  it('writes and reads a plan record', async () => {
    await writePlan(stagingDir, sampleRecord);
    const round = await readPlan(stagingDir);
    expect(round).toEqual(sampleRecord);
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
    const bad = { ...sampleRecord, stages: [] } as PlanRecord;
    await expect(writePlan(stagingDir, bad)).rejects.toThrow();
  });

  it('planRecordPath returns the expected file path', () => {
    expect(planRecordPath(stagingDir)).toBe(path.join(stagingDir, 'plan.json'));
  });
});
