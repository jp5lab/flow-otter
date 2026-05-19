import { z } from 'zod';

import { CORE_NODE_TYPES } from '../../../toolkit/catalog/data.js';
import { hasNodeSchema, knownNodeTypes } from '../../../toolkit/authoring/node-schemas.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const CORE_TYPES = new Set(CORE_NODE_TYPES.map((n) => n.type));

const OutputSchema = z.object({
  source: z.enum(['admin-api', 'unavailable']),
  modules: z.unknown(),
  typed_modules: z.array(
    z.object({
      type: z.string(),
      /**
       * True if FlowOtter ships a typed Zod schema for this node type
       * via add_inject_node / add_function_node / etc. (the
       * `author_specialists` toolset). False for contrib packages with no
       * dedicated specialist — those go through generic add_node with
       * `passthrough` validation.
       */
      has_schema: z.boolean(),
      /**
       * True if the type is in FlowOtter's core node-type catalog (per
       * `get_authoring_guide(['core_node_types'])`). False indicates the
       * type was installed via a node-red-contrib-* package (Modbus,
       * InfluxDB, OPC UA, etc.) and FlowOtter knows it only by name from
       * the runtime's /nodes response.
       */
      is_core: z.boolean(),
    }),
  ),
  flow_otter_known_typed_types: z.array(z.string()),
});
type Output = z.infer<typeof OutputSchema>;

export const listInstalledNodeTypesTool: Tool<Input, Output> = {
  name: 'list_installed_node_types',
  description:
    'Returns the list of node modules and node types installed in the Node-RED runtime via the Admin API. Each type is annotated with `has_schema:bool` (FlowOtter ships a typed schema → use the specialist tool) and `is_core:bool` (in the canonical Node-RED palette vs a node-red-contrib-* package). Generic add_node({type, ...}) works for every entry; specialists in the author_specialists toolset give typed validation for those that have a schema. Requires FLOW_SOURCE=admin-api.',
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
      is_core: CORE_TYPES.has(type),
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
