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

const FILENAME = 'plan.json';

const StageSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1),
  estimated_nodes: z.number().int().positive(),
  organization: z.enum(['inline', 'group', 'subflow', 'separate_tab']),
  organization_rationale: z.string().min(1),
});

export type PlanStage = z.infer<typeof StageSchema>;

export const PlanRecordSchema = z.object({
  schema_version: z.literal(1),
  plan_id: z.string().min(1),
  recorded_at: z.string().min(1),
  actor: z.string(),
  goal: z.string().min(1),
  stages: z.array(StageSchema).min(1),
  total_estimated_nodes: z.number().int().nonnegative(),
  layout_strategy: z.enum(['dagre_auto', 'elk_layered', 'manual']),
  layout_rationale: z.string().min(1),
  next_actions: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export type PlanRecord = z.infer<typeof PlanRecordSchema>;

function planPath(dir: string): string {
  return path.join(dir, FILENAME);
}

export async function writePlan(dir: string, record: PlanRecord): Promise<void> {
  await mkdir(dir, { recursive: true });
  const validated = PlanRecordSchema.parse(record);
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
