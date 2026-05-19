import { z } from 'zod';

import { DEFAULT_TOOLSETS, TOOLSETS, type ToolsetName } from '../toolsets.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const ToolsetEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  default_enabled: z.boolean(),
  currently_enabled: z.boolean(),
  tool_names: z.array(z.string()),
});

const OutputSchema = z.object({
  default_toolsets: z.array(z.string()),
  toolsets: z.array(ToolsetEntrySchema),
});
type Output = z.infer<typeof OutputSchema>;

export const listAvailableToolsetsTool: Tool<Input, Output> = {
  name: 'list_available_toolsets',
  description:
    "Lists all toolsets FlowOtter ships with, indicating which are enabled in the current session. Use enable_toolset to load a non-default toolset (e.g., 'author_specialists' for typed add_<type>_node tools). Read-only.",
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: (_input, ctx) => {
    void _input;
    const registry = ctx.container.toolRegistry;
    const enabled = new Set<string>(
      registry !== undefined ? registry.enabledToolsets() : DEFAULT_TOOLSETS,
    );
    const toolsets = (Object.keys(TOOLSETS) as ToolsetName[]).map((name) => {
      const t = TOOLSETS[name];
      return {
        name: t.name,
        description: t.description,
        default_enabled: t.default_enabled,
        currently_enabled: enabled.has(t.name),
        tool_names: [...t.tool_names],
      };
    });
    return Promise.resolve({
      default_toolsets: [...DEFAULT_TOOLSETS],
      toolsets,
    });
  },
};
