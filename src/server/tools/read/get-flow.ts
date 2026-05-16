import { z } from 'zod';

import { isTab } from '../../../shared/flows-json.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  tab: z.object({
    id: z.string(),
    label: z.string(),
    disabled: z.boolean(),
    info: z.string().optional(),
  }),
  nodes: z.array(z.record(z.unknown())),
});
type Output = z.infer<typeof OutputSchema>;

export const getFlowTool: Tool<Input, Output> = {
  name: 'get_flow',
  description:
    'Returns the tab metadata and every node (including groups/comments) on that tab. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: { tab_id: { type: 'string', minLength: 1 } },
    required: ['tab_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows, rev } = await ctx.flowSource.load();
    const tab = flows.find((n) => isTab(n) && n.id === input.tab_id);
    if (!tab || !isTab(tab)) {
      throw new ValidationFailedError(`Tab '${input.tab_id}' not found.`, []);
    }
    const nodes = flows.filter((n) => !isTab(n) && (n as { z?: unknown }).z === input.tab_id);
    return {
      rev,
      tab: {
        id: tab.id,
        label: tab.label,
        disabled: tab.disabled === true,
        ...(typeof tab.info === 'string' ? { info: tab.info } : {}),
      },
      nodes: nodes as unknown as Record<string, unknown>[],
    };
  },
};
