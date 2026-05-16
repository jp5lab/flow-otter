import { z } from 'zod';

import {
  isSubflowDef,
  isSubflowInstance,
  SUBFLOW_INSTANCE_PREFIX,
} from '../../../shared/flows-json.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    subflow_id: z.string().min(1),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  definition: z.record(z.unknown()),
  ports: z.object({
    in: z.number().int().nonnegative(),
    out: z.number().int().nonnegative(),
  }),
  instance_count: z.number().int().nonnegative(),
  instances: z.array(
    z.object({ id: z.string(), tab_id: z.string().nullable(), label: z.string().nullable() }),
  ),
});
type Output = z.infer<typeof OutputSchema>;

export const getSubflowTool: Tool<Input, Output> = {
  name: 'get_subflow',
  description:
    'Returns a subflow definition with its declared ports plus a list of instances using it. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: { subflow_id: { type: 'string', minLength: 1 } },
    required: ['subflow_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const { flows, rev } = await ctx.flowSource.load();
    const def = flows.find((n) => isSubflowDef(n) && n.id === input.subflow_id);
    if (!def || !isSubflowDef(def)) {
      throw new ValidationFailedError(`Subflow definition '${input.subflow_id}' not found.`, []);
    }
    const inLen = Array.isArray(def.in) ? def.in.length : 0;
    const outLen = Array.isArray(def.out) ? def.out.length : 0;
    const instances: { id: string; tab_id: string | null; label: string | null }[] = [];
    for (const n of flows) {
      if (!isSubflowInstance(n)) continue;
      if (n.type.slice(SUBFLOW_INSTANCE_PREFIX.length) !== input.subflow_id) continue;
      const z = (n as { z?: unknown }).z;
      const name = (n as { name?: unknown }).name;
      instances.push({
        id: n.id,
        tab_id: typeof z === 'string' ? z : null,
        label: typeof name === 'string' ? name : null,
      });
    }
    return {
      rev,
      definition: def as unknown as Record<string, unknown>,
      ports: { in: inLen, out: outLen },
      instance_count: instances.length,
      instances,
    };
  },
};
