import { z } from 'zod';

export const AuditResultSchema = z.enum([
  'success',
  'validation_failed',
  'drift_detected',
  'blocked',
  'error',
  'warning',
]);
export type AuditResult = z.infer<typeof AuditResultSchema>;

export const AuditModeSchema = z.enum([
  'read',
  'validate',
  'stage',
  'apply',
  'deploy',
  'rollback',
  'dangerous',
]);
export type AuditMode = z.infer<typeof AuditModeSchema>;

export const DiffSummarySchema = z.object({
  tabs_changed: z.number().int().nonnegative().optional(),
  nodes_added: z.number().int().nonnegative(),
  nodes_removed: z.number().int().nonnegative(),
  nodes_modified: z.number().int().nonnegative(),
  wires_added: z.number().int().nonnegative(),
  wires_removed: z.number().int().nonnegative(),
});
export type DiffSummary = z.infer<typeof DiffSummarySchema>;

export const AuditEventSchema = z.object({
  ts: z.string(),
  actor: z.string(),
  agent_identity: z.string().optional(),
  tool: z.string(),
  tier: z.enum(['read', 'author', 'validate', 'stage', 'deploy', 'dangerous']),
  args_hash: z.string(),
  mode: AuditModeSchema.optional(),
  snapshot_before: z.string().nullable().optional(),
  snapshot_after: z.string().nullable().optional(),
  diff_summary: DiffSummarySchema.optional(),
  deployment_mode: z.enum(['full', 'nodes', 'flows', 'reload']).optional(),
  result: AuditResultSchema,
  error: z.string().nullable().optional(),
  duration_ms: z.number().nonnegative().optional(),
  flow_source: z.string().optional(),
  environment: z.string().optional(),
  server_version: z.string().optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
