import { z } from 'zod';

import type { Tool } from '../_tool.js';

const InputSchema = z
  .object({
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  count: z.number().int().nonnegative(),
  entries: z.array(
    z.object({
      raw: z.string(),
      parsed: z.record(z.unknown()).optional(),
      parseError: z.string().optional(),
    }),
  ),
});
type Output = z.infer<typeof OutputSchema>;

export const getAuditLogRecentTool: Tool<Input, Output> = {
  name: 'get_audit_log_recent',
  description:
    'Returns up to N most recent audit log entries (already redacted at write time). Default 50, max 500.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const n = input.limit ?? 50;
    const entries = await ctx.audit.tail(n);
    return {
      count: entries.length,
      entries: entries.map((e) => ({
        raw: e.raw,
        ...(e.parsed !== undefined ? { parsed: e.parsed } : {}),
        ...(e.parseError !== undefined ? { parseError: e.parseError } : {}),
      })),
    };
  },
};
