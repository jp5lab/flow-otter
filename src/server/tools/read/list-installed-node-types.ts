import { z } from 'zod';

import { hasNodeSchema, knownNodeTypes } from '../../../toolkit/authoring/node-schemas.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  source: z.enum(['admin-api', 'unavailable']),
  modules: z.unknown(),
  typed_modules: z.array(
    z.object({
      type: z.string(),
      has_schema: z.boolean(),
    }),
  ),
  flow_otter_known_typed_types: z.array(z.string()),
});
type Output = z.infer<typeof OutputSchema>;

export const listInstalledNodeTypesTool: Tool<Input, Output> = {
  name: 'list_installed_node_types',
  description:
    'Returns the list of node modules and node types installed in the Node-RED runtime via the Admin API, augmented with `has_schema:bool` indicating whether FlowOtter has a per-type Zod schema registered for that type (use add_node with confidence). Requires FLOW_SOURCE=admin-api.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    if (!ctx.noderedClient) {
      throw new ValidationFailedError(
        'list_installed_node_types requires FLOW_SOURCE=admin-api with a configured NODE_RED_BASE_URL.',
        [],
      );
    }
    const modules = await ctx.noderedClient.getNodeTypes();
    const typedModules = extractTypes(modules).map((type) => ({
      type,
      has_schema: hasNodeSchema(type),
    }));
    return {
      source: 'admin-api',
      modules,
      typed_modules: typedModules,
      flow_otter_known_typed_types: Array.from(knownNodeTypes()),
    };
  },
};

/**
 * Node-RED's /nodes endpoint returns an array of installed node modules with
 * one or more `types: string[]` per module. Flatten into a unique type list.
 */
function extractTypes(modules: unknown): readonly string[] {
  const out = new Set<string>();
  if (!Array.isArray(modules)) return [];
  for (const m of modules) {
    if (m && typeof m === 'object' && Array.isArray((m as { types?: unknown }).types)) {
      for (const t of (m as { types: unknown[] }).types) {
        if (typeof t === 'string') out.add(t);
      }
    }
  }
  return Array.from(out).sort();
}
