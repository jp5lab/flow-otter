import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { LANE_NAMES } from '../../../toolkit/lanes.js';
import {
  buildSpatialScaffold,
  SpatialScaffoldSchema,
} from '../../../toolkit/layout/spatial-scaffold.js';
import { writePlan, type PlanRecordV2 } from '../../../toolkit/staging/plan-record.js';
import type { Tool } from '../_tool.js';

const LaneSchema = z.enum(LANE_NAMES);

const StageInputSchema = z.object({
  name: z.string().min(1).max(64),
  purpose: z.string().min(1).max(300),
  estimated_nodes: z.number().int().positive().max(200),
  organization: z.enum(['inline', 'group', 'subflow', 'separate_tab']),
  organization_rationale: z.string().min(1).max(300),
  lane: LaneSchema.optional(),
});

const InputSchema = z
  .object({
    goal: z.string().min(1).max(500),
    stages: z.array(StageInputSchema).min(1).max(20),
    notes: z.string().max(1000).optional(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const StageOutputSchema = StageInputSchema;

const OutputSchema = z.object({
  ok: z.literal(true),
  plan_id: z.string(),
  recorded_at: z.string(),
  goal_summary: z.string(),
  stages: z.array(StageOutputSchema),
  total_estimated_nodes: z.number().int().nonnegative(),
  layout_strategy: z.enum(['dagre_auto', 'elk_layered', 'manual']),
  layout_rationale: z.string(),
  spatial_scaffold: SpatialScaffoldSchema,
  next_actions: z.array(z.string()),
  warnings: z.array(z.string()),
});
type Output = z.infer<typeof OutputSchema>;

/**
 * Layout is currently an explicit authoring task, not an exposed automatic
 * MCP operation. The toolkit still has deterministic layout helpers, but no
 * `layout_flow` tool exists yet; plan_flow must not imply one.
 */
function chooseLayoutStrategy(stages: readonly z.infer<typeof StageInputSchema>[]): {
  strategy: 'manual';
  rationale: string;
} {
  const total = stages.reduce((n, s) => n + s.estimated_nodes, 0);
  const hasGroupOrSubflow = stages.some(
    (s) => s.organization === 'group' || s.organization === 'subflow',
  );
  return {
    strategy: 'manual',
    rationale: `Use explicit node positions, group geometry, and render_flow_svg review. Auto-layout is not exposed as an MCP tool yet${hasGroupOrSubflow ? '; grouped/subflow-heavy flows need human visual approval' : ''}${total >= 30 ? `, especially at ${total} estimated nodes` : ''}.`,
  };
}

/**
 * Generate the sequence of next-tool-call hints the agent should follow for
 * this plan. References real FlowOtter tool names. The plan_flow tool
 * intentionally does NOT invoke these — it's a methodology scaffold, the
 * agent is responsible for execution.
 */
function buildNextActions(input: Input): string[] {
  const out: string[] = [];
  const usesSubflow = input.stages.some((s) => s.organization === 'subflow');
  const usesGroup = input.stages.some((s) => s.organization === 'group');
  const usesTabs = input.stages.some((s) => s.organization === 'separate_tab');

  if (usesSubflow) {
    out.push(
      'For each "subflow" stage, call create_subflow_definition first, then add_subflow_instance per instantiation.',
    );
  }
  if (usesTabs) {
    out.push('For each "separate_tab" stage, ensure a tab exists (create_flow if needed).');
  }
  if (usesGroup) {
    out.push(
      'For each "group" stage, call add_group after the constituent nodes are placed. Supply position/size when you know the visual bounds.',
    );
  }
  out.push(
    'Add nodes for each stage with add_node (preferred) or specialist tools (after enable_toolset author_specialists). Do NOT wire while structuring.',
  );
  out.push(
    'Record each stage purpose in node/group info so the rendered flow stays self-documenting.',
  );
  out.push(
    'Once all nodes are placed, wire them: wire_nodes for single edges, set_wires for bulk.',
  );
  out.push('Refine layout with explicit positions, move_node, and add_group geometry.');
  out.push('render_flow_svg and show the user; confirm with elicitation before deploying.');
  out.push(
    'validate_flow, preview_flow_diff, then deploy_staged_change — never deploy without explicit confirmation.',
  );
  return out;
}

/**
 * Soft-warn the agent if the plan looks off. Returned as `warnings[]` in
 * the tool response; not a hard error.
 */
function buildWarnings(input: Input, total: number): string[] {
  const out: string[] = [];
  if (total > 100) {
    out.push(
      `Total estimated nodes (${total}) is large. Consider splitting into multiple tabs or subflows.`,
    );
  }
  for (const s of input.stages) {
    if (s.estimated_nodes > 30) {
      out.push(
        `Stage "${s.name}" estimates ${s.estimated_nodes} nodes — that's a lot for one stage. Consider subdividing.`,
      );
    }
    if (s.estimated_nodes >= 5 && s.organization === 'inline') {
      out.push(
        `Stage "${s.name}" has ${s.estimated_nodes} nodes inline — wrap in a group (or subflow if the pattern repeats elsewhere).`,
      );
    }
  }
  if (input.stages.length === 1) {
    out.push(
      'Only one stage planned. plan_flow is most useful when there are 3+ stages — for trivial flows, you can skip it.',
    );
  }
  return out;
}

export const planFlowTool: Tool<Input, Output> = {
  name: 'plan_flow',
  description:
    'Records a structured authoring plan for the current flow: stages, organization decisions (group vs subflow vs link vs tab), estimated node count, lane hints, and a deterministic spatial scaffold. Writes ~/.flow-otter/<env>/staging/plan.json so soft-nudge guidance can later detect "you started adding nodes without planning." Use this BEFORE adding any nodes on a flow that will exceed ~10 nodes or contain operator dashboards.',
  tier: 'author',
  inputZod: InputSchema,
  inputJsonSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
        description: 'Short statement of what this flow needs to accomplish.',
      },
      stages: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description:
          'Ordered list of logical stages this flow will implement. Each stage maps to one organizational unit (group, subflow, separate tab, or inline).',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 64 },
            purpose: { type: 'string', minLength: 1, maxLength: 300 },
            estimated_nodes: { type: 'integer', minimum: 1, maximum: 200 },
            organization: {
              type: 'string',
              enum: ['inline', 'group', 'subflow', 'separate_tab'],
            },
            organization_rationale: { type: 'string', minLength: 1, maxLength: 300 },
            lane: {
              type: 'string',
              enum: ['main', 'indicate', 'error'],
              description: 'Optional lane hint for this stage. Omit for normal main-flow stages.',
            },
          },
          required: [
            'name',
            'purpose',
            'estimated_nodes',
            'organization',
            'organization_rationale',
          ],
          additionalProperties: false,
        },
      },
      notes: { type: 'string', maxLength: 1000 },
    },
    required: ['goal', 'stages'],
    additionalProperties: false,
  },
  outputZod: OutputSchema,
  handler: async (input, ctx) => {
    const total = input.stages.reduce((n, s) => n + s.estimated_nodes, 0);
    const { strategy, rationale } = chooseLayoutStrategy(input.stages);
    const nextActions = buildNextActions(input);
    const warnings = buildWarnings(input, total);
    const spatialScaffold = buildSpatialScaffold(input.stages);
    const planId = randomUUID();
    const recordedAt = ctx.clock().toISOString();

    const record: PlanRecordV2 = {
      schema_version: 2,
      plan_id: planId,
      recorded_at: recordedAt,
      actor: ctx.config.ACTOR_NAME,
      goal: input.goal,
      stages: input.stages.map((s) => ({ ...s })),
      total_estimated_nodes: total,
      layout_strategy: strategy,
      layout_rationale: rationale,
      next_actions: nextActions,
      spatial_scaffold: spatialScaffold,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };

    await writePlan(ctx.config.STAGING_DIR, record);

    return {
      ok: true,
      plan_id: planId,
      recorded_at: recordedAt,
      goal_summary: input.goal,
      stages: record.stages,
      total_estimated_nodes: total,
      layout_strategy: strategy,
      layout_rationale: rationale,
      spatial_scaffold: spatialScaffold,
      next_actions: nextActions,
      warnings,
    };
  },
};
