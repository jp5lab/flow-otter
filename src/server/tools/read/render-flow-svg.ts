import { z } from 'zod';

import { isTab } from '../../../shared/flows-json.js';
import { renderSvg } from '../../../toolkit/render/svg.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  tab_id: z.string(),
  svg: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const renderFlowSvgTool: Tool<Input, Output> = {
  name: 'render_flow_svg',
  description: 'Returns a deterministic SVG rendering of a single tab. Read-only.',
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
    if (!tab) throw new ValidationFailedError(`Tab '${input.tab_id}' not found.`, []);
    const svg = renderSvg(flows, { tabId: input.tab_id });
    return { rev, tab_id: input.tab_id, svg };
  },
};
