import { z } from 'zod';

import type { FlowsJsonNode } from '../../../shared/flows-json.js';
import type { Tool } from '../_tool.js';

const InputSchema = z
  .object({
    type: z.string().optional(),
    label_regex: z.string().optional(),
    tab_id: z.string().optional(),
    has_property: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  matches: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      tab_id: z.string().nullable(),
      label: z.string().nullable(),
    }),
  ),
  truncated: z.boolean(),
});
type Output = z.infer<typeof OutputSchema>;

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function nodeLabel(n: FlowsJsonNode): string | null {
  if ('name' in n && typeof n.name === 'string') return n.name;
  if ('label' in n && typeof n.label === 'string') return n.label;
  return null;
}

export const searchNodesTool: Tool<Input, Output> = {
  name: 'search_nodes',
  description:
    'Filters nodes by type glob, label regex, tab id, or has-property. Returns id/type/tab/label. Default limit 100.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      label_regex: { type: 'string' },
      tab_id: { type: 'string' },
      has_property: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
    },
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows, rev } = await ctx.flowSource.load();
    const limit = input.limit ?? 100;
    const typeRegex = input.type !== undefined ? globToRegex(input.type) : null;
    const labelRegex = input.label_regex !== undefined ? new RegExp(input.label_regex) : null;

    const matches: Array<{
      id: string;
      type: string;
      tab_id: string | null;
      label: string | null;
    }> = [];
    let total = 0;
    for (const n of flows) {
      if (typeRegex && !typeRegex.test(n.type)) continue;
      const z = (n as { z?: unknown }).z;
      if (input.tab_id !== undefined && z !== input.tab_id) continue;
      const label = nodeLabel(n);
      if (labelRegex && (label === null || !labelRegex.test(label))) continue;
      if (input.has_property !== undefined && !(input.has_property in n)) continue;
      total++;
      if (matches.length < limit) {
        matches.push({
          id: n.id,
          type: n.type,
          tab_id: typeof z === 'string' ? z : null,
          label,
        });
      }
    }
    return { rev, matches, truncated: total > matches.length };
  },
};
