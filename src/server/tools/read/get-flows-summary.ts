import { z } from 'zod';

import { isComment, isGroup, isSubflowDef, isTab } from '../../../shared/flows-json.js';
import { canonicalHash } from '../../../shared/hash.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  hash: z.string(),
  totals: z.object({
    tabs: z.number().int().nonnegative(),
    subflow_defs: z.number().int().nonnegative(),
    groups: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    config_nodes: z.number().int().nonnegative(),
    wires: z.number().int().nonnegative(),
  }),
  type_histogram: z.record(z.number().int().nonnegative()),
});
type Output = z.infer<typeof OutputSchema>;

export const getFlowsSummaryTool: Tool<Input, Output> = {
  name: 'get_flows_summary',
  description:
    'Returns aggregate counts (tabs, nodes, wires, type histogram) and a content hash of the current flows. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputZod: OutputSchema,
  handler: async (_input, ctx) => {
    void _input;
    const { flows, rev } = await ctx.flowSource.load();

    let tabs = 0;
    let subflowDefs = 0;
    let groups = 0;
    let comments = 0;
    let nodes = 0;
    let configNodes = 0;
    let wires = 0;
    const histogram = new Map<string, number>();

    for (const n of flows) {
      if (isTab(n)) {
        tabs++;
        continue;
      }
      if (isSubflowDef(n)) {
        subflowDefs++;
        continue;
      }
      if (isGroup(n)) {
        groups++;
        continue;
      }
      if (isComment(n)) {
        comments++;
        continue;
      }
      const hasZ = typeof (n as { z?: unknown }).z === 'string';
      const hasWires = Array.isArray((n as { wires?: unknown }).wires);
      if (hasZ && hasWires) {
        nodes++;
        const w = (n as { wires?: string[][] }).wires ?? [];
        for (const arr of w) wires += arr.length;
      } else {
        configNodes++;
      }
      histogram.set(n.type, (histogram.get(n.type) ?? 0) + 1);
    }

    return {
      rev,
      hash: canonicalHash(flows),
      totals: {
        tabs,
        subflow_defs: subflowDefs,
        groups,
        comments,
        nodes,
        config_nodes: configNodes,
        wires,
      },
      type_histogram: Object.fromEntries(histogram),
    };
  },
};
