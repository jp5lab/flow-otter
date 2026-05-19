import type { Nudge } from '../types.js';

/**
 * Fires when the agent invokes an authoring tool on a flow that has
 * substantial structure (≥10 staged nodes) but no plan_flow record
 * exists. The threshold matches the `instructions` field's "for any flow
 * >10 nodes, call plan_flow first" guidance.
 *
 * Skip when the call IS plan_flow itself (creating the plan), to avoid
 * a redundant reminder.
 */
const TRIGGER_NODE_COUNT = 10;

const APPLIES_TO_TOOLS = new Set<string>([
  'add_node',
  'add_inject_node',
  'add_debug_node',
  'add_function_node',
  'add_catch_node',
  'add_status_node',
  'add_complete_node',
  'add_mqtt_in_node',
  'add_mqtt_out_node',
  'add_link_in_node',
  'add_link_out_node',
  'add_link_call_node',
  'add_subflow_instance',
  'add_group',
  'add_comment',
  'add_dashboard_widget',
  'create_subflow_definition',
  'wire_nodes',
  'set_wires',
  'set_links',
  'instantiate_template',
]);

export const noPlanForLargeFlowNudge: Nudge = {
  id: 'no-plan-for-large-flow',
  description:
    'Reminds the agent to call plan_flow when authoring on a flow that has substantial structure (≥10 nodes) without a recorded plan.',
  applies: (toolName) => APPLIES_TO_TOOLS.has(toolName),
  check: (ctx) => {
    if (ctx.staging.has_plan) return null;
    if (ctx.staging.node_count < TRIGGER_NODE_COUNT) return null;
    return `No plan_flow record exists for the current staged change (${ctx.staging.node_count} nodes already staged). For flows of this size, FlowOtter's methodology recommends calling plan_flow first to decide stages, organization (groups vs subflows vs link nodes vs separate tabs), and layout strategy. Call plan_flow before continuing to add nodes.`;
  },
};
