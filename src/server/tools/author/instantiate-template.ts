import { z } from 'zod';

import { instantiateTemplate } from '../../../toolkit/templates/index.js';
import { type Tool } from '../_tool.js';

import { runStagedAuthorOp } from './_stage-pipeline.js';
import { StageRenderOutputSchema } from './_stage-render.js';

const InputSchema = z
  .object({
    template_name: z.string().min(1, 'template_name is required'),
    params: z.record(z.unknown()).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const DiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  rule: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  tabId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  template_name: z.string(),
  staged_hash: z.string(),
  based_on_snapshot_hash: z.string(),
  based_on_rev: z.string().nullable(),
  diff_summary: z.object({
    nodes_added: z.number(),
    nodes_removed: z.number(),
    nodes_modified: z.number(),
    wires_added: z.number(),
    wires_removed: z.number(),
  }),
  diagnostics: z.array(DiagnosticSchema),
  render: StageRenderOutputSchema,
});
type Output = z.infer<typeof OutputSchema>;

export const instantiateTemplateTool: Tool<Input, Output> = {
  name: 'instantiate_template',
  description:
    'Stages a built-in flow template against the current runtime. Validates and lints the result; produces a semantic diff. Does NOT deploy — call deploy_staged_change to push to the runtime.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      template_name: { type: 'string', minLength: 1 },
      params: { type: 'object', additionalProperties: true },
    },
    required: ['template_name'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: (input, ctx) =>
    runStagedAuthorOp<Record<string, never>, Output>(
      ctx,
      { toolName: 'instantiate_template' },
      (priorSpec, _priorFlows) => {
        const nextSpec = instantiateTemplate(priorSpec, input.template_name, input.params);
        return { nextSpec, extras: {} };
      },
      (base) => ({
        ok: base.ok,
        template_name: input.template_name,
        staged_hash: base.staged_hash,
        based_on_snapshot_hash: base.based_on_snapshot_hash,
        based_on_rev: base.based_on_rev,
        diff_summary: base.diff_summary,
        diagnostics: [...base.diagnostics],
        render: base.render,
      }),
    ),
};
