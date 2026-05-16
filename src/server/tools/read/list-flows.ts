import { z } from 'zod';

import { isTab } from '../../../shared/flows-json.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const TabSchema = z.object({
  id: z.string(),
  authoring_key: z.string(),
  label: z.string(),
  disabled: z.boolean(),
  node_count: z.number().int().nonnegative(),
});

const OutputSchema = z.object({
  rev: z.string().nullable(),
  tabs: z.array(TabSchema),
});
type Output = z.infer<typeof OutputSchema>;

export const listFlowsTool: Tool<Input, Output> = {
  name: 'list_flows',
  description:
    'Lists all tabs (flows). Each entry exposes both `id` (Node-RED tab ID) and `authoring_key` — author tools accept either form when resolving a tab. They are equal when the tab was not authored through FlowOtter. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    const { flows, rev } = await ctx.flowSource.load();
    const counts = new Map<string, number>();
    for (const node of flows) {
      const z = (node as { z?: unknown }).z;
      if (typeof z === 'string') counts.set(z, (counts.get(z) ?? 0) + 1);
    }
    const tabs = flows.filter(isTab).map((t) => {
      const ext = (t as Record<string, unknown>)['_authoringKey'];
      const authoringKey = typeof ext === 'string' ? ext : t.id;
      return {
        id: t.id,
        authoring_key: authoringKey,
        label: t.label,
        disabled: t.disabled === true,
        node_count: counts.get(t.id) ?? 0,
      };
    });
    return { rev, tabs };
  },
};
