/**
 * Plan record — the artifact produced by the `plan_flow` MCP tool. Lives in
 * the same staging directory as `staged.json` (so it shares a target's
 * scope) but separate from it (plans are scoped to authoring intent, not
 * the work-in-progress flow tree).
 *
 * The soft-nudge subsystem reads plan presence/age to decide whether to
 * remind the agent to call `plan_flow` before continuing to add nodes on a
 * substantial flow.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { LANE_NAMES } from '../lanes.js';
import { SpatialScaffoldSchema } from '../layout/spatial-scaffold.js';

const FILENAME = 'plan.json';

const LaneSchema = z.enum(LANE_NAMES);

const StageV1Schema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  estimated_nodes: z.number().int().positive(),
  organization: z.enum(['inline', 'group', 'subflow', 'separate_tab']),
  organization_rationale: z.string().min(1),
});

const StageV2Schema = StageV1Schema.extend({
  lane: LaneSchema.optional(),
});

export type PlanStageV1 = z.infer<typeof StageV1Schema>;
export type PlanStage = z.infer<typeof StageV2Schema>;

const PlanRecordBaseSchema = z.object({
  plan_id: z.string().min(1),
  recorded_at: z.string().min(1),
  actor: z.string(),
  goal: z.string().min(1),
  total_estimated_nodes: z.number().int().nonnegative(),
  layout_strategy: z.enum(['dagre_auto', 'elk_layered', 'manual']),
  layout_rationale: z.string().min(1),
  next_actions: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export const PlanRecordV1Schema = PlanRecordBaseSchema.extend({
  schema_version: z.literal(1),
  stages: z.array(StageV1Schema).min(1),
});

export const PlanRecordV2Schema = PlanRecordBaseSchema.extend({
  schema_version: z.literal(2),
  stages: z.array(StageV2Schema).min(1),
  spatial_scaffold: SpatialScaffoldSchema,
});

export const PlanRecordSchema = z.discriminatedUnion('schema_version', [
  PlanRecordV1Schema,
  PlanRecordV2Schema,
]);

export type PlanRecordV1 = z.infer<typeof PlanRecordV1Schema>;
export type PlanRecordV2 = z.infer<typeof PlanRecordV2Schema>;
export type PlanRecord = z.infer<typeof PlanRecordSchema>;

function planPath(dir: string): string {
  return path.join(dir, FILENAME);
}

export async function writePlan(dir: string, record: PlanRecordV2): Promise<void> {
  await mkdir(dir, { recursive: true });
  const validated = PlanRecordV2Schema.parse(record);
  // Atomic write: write to a per-pid tmp file and rename into place. Readers
  // see either the prior file or the new one — never a half-written file.
  // PID is sufficient to avoid intra-process write races without invoking
  // Math.random (forbidden in src/toolkit/* by the idempotency invariant).
  const tmp = `${planPath(dir)}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await rename(tmp, planPath(dir));
}

export async function readPlan(dir: string): Promise<PlanRecord | null> {
  try {
    const raw = await readFile(planPath(dir), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return PlanRecordSchema.parse(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function clearPlan(dir: string): Promise<boolean> {
  try {
    await unlink(planPath(dir));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export function planRecordPath(dir: string): string {
  return planPath(dir);
}
