import { z } from 'zod';

import { isTab, type FlowsJson } from '../../../shared/flows-json.js';
import { renderSvg } from '../../../toolkit/render/svg.js';
import { ValidationFailedError, type Tool } from '../_tool.js';

const InputSchema = z
  .object({
    tab_id: z.string().min(1),
    against: z.enum(['staged', 'runtime']).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  rev: z.string().nullable(),
  tab_id: z.string(),
  against: z.enum(['staged', 'runtime']),
  staged_hash: z.string().nullable(),
  based_on_snapshot_hash: z.string().nullable(),
  svg: z.string(),
});
type Output = z.infer<typeof OutputSchema>;

export const renderFlowSvgTool: Tool<Input, Output> = {
  name: 'render_flow_svg',
  description:
    "Returns a deterministic SVG rendering of a single tab. against:'staged' renders the pending " +
    "staged change; the default ('runtime') renders the deployed runtime flows, which do NOT " +
    'include any pending staged change. Read-only.',
  tier: 'read',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      tab_id: { type: 'string', minLength: 1 },
      against: {
        type: 'string',
        enum: ['staged', 'runtime'],
        description:
          "What to render: 'staged' = the pending staged change (errors if the staging slot is " +
          "empty), 'runtime' = the deployed runtime flows (default).",
      },
    },
    required: ['tab_id'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const against = input.against ?? 'runtime';
    let flows: FlowsJson;
    let rev: string | null;
    let stagedHash: string | null = null;
    let basedOnSnapshotHash: string | null = null;
    if (against === 'staged') {
      const staged = await ctx.staging.read();
      if (!staged) {
        throw new ValidationFailedError(
          "No staged change to render. Stage a change with an author tool first, or call render_flow_svg with against:'runtime' (the default) to render the deployed flows.",
          [
            {
              severity: 'error',
              rule: 'staging/no-staged-change',
              message:
                "render_flow_svg(against:'staged') requires a pending staged change, but the staging slot is empty. Use get_staged_change to inspect staging state.",
            },
          ],
        );
      }
      flows = staged.flows;
      // The runtime rev the staged change was computed against — the same
      // provenance get_staged_change reports as based_on_rev.
      rev = staged.basedOnRev;
      stagedHash = staged.stagedHash;
      basedOnSnapshotHash = staged.basedOnSnapshotHash;
    } else {
      ({ flows, rev } = await ctx.flowSource.load());
    }
    const tab = flows.find((n) => isTab(n) && n.id === input.tab_id);
    if (!tab) {
      throw new ValidationFailedError(
        `Tab '${input.tab_id}' not found${against === 'staged' ? ' in the staged change' : ''}.`,
        [],
      );
    }
    const svg = renderSvg(flows, { tabId: input.tab_id });
    return {
      rev,
      tab_id: input.tab_id,
      against,
      staged_hash: stagedHash,
      based_on_snapshot_hash: basedOnSnapshotHash,
      svg,
    };
  },
};
