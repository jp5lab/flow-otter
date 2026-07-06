/**
 * MCP prompts registered by FlowOtter. Prompts surface to users as
 * /mcp__flow-otter__<name> slash commands in Claude Code (and equivalent
 * menus in other clients). They're how the *user* discovers FlowOtter
 * capabilities — the agent discovers via tool descriptions and
 * get_authoring_guide.
 *
 * Each prompt returns structured content that walks the agent through a
 * canonical workflow, referencing the real tool calls and the FlowOtter
 * methodology embedded in the server instructions.
 */

export interface FlowOtterPromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
}

export interface FlowOtterPrompt {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly FlowOtterPromptArgument[];
  /**
   * Build the prompt body from caller-supplied args. Returns a single string
   * that the client renders as the user message kicking off the workflow.
   */
  readonly build: (args: Readonly<Record<string, string>>) => string;
}

function arg(args: Readonly<Record<string, string>>, name: string, fallback = ''): string {
  return typeof args[name] === 'string' && args[name].length > 0 ? args[name] : fallback;
}

const newFlowPrompt: FlowOtterPrompt = {
  name: 'new_flow',
  description:
    'Build a new Node-RED flow end-to-end with FlowOtter. Walks plan → organize → structure → wire → visual review → deploy.',
  arguments: [
    {
      name: 'goal',
      description: 'One-sentence description of what this flow should do.',
      required: true,
    },
    {
      name: 'template',
      description: 'Optional starting template name (e.g., mqtt_to_debug). Omit for an empty flow.',
    },
  ],
  build: (args) => {
    const goal = arg(args, 'goal', '(no goal given)');
    const template = arg(args, 'template');
    return [
      `Build a new Node-RED flow.`,
      `Goal: ${goal}`,
      ``,
      `Follow the FlowOtter methodology:`,
      `1. Call plan_flow with this goal — decompose into stages and choose organization (group vs subflow vs link nodes vs separate tab).`,
      template
        ? `2. Call instantiate_template('${template}') for a starting scaffold; otherwise start empty.`
        : `2. Start with an empty staged change.`,
      `3. For each stage: add nodes (prefer add_node; enable_toolset('author_specialists') if you need typed conveniences).`,
      `4. Wire stages with wire_nodes / set_wires.`,
      `5. Refine layout explicitly with positions, move_node, and add_group geometry (do not assume auto-layout is available): 20px grid; stages left-to-right at a 140-220px column pitch; error lane ≥120px BELOW the happy path; switch port 0 (affirmative) on top; keep the tab ≤1420px wide.`,
      `6. render_flow_svg with against:'staged' (the default renders the deployed runtime, which does not include your pending change) and show me the result before programming/deploying substantial flows.`,
      `7. validate_flow must pass.`,
      `8. preview_flow_diff, then deploy_staged_change — I will be elicited to confirm.`,
    ].join('\n');
  },
};

const buildOperatorDashboardPrompt: FlowOtterPrompt = {
  name: 'build_operator_dashboard',
  description:
    'Compose an ISA-101 operator dashboard from FlowOtter built-in operator templates. Wires structure → widgets → confirm-before-deploy.',
  arguments: [
    {
      name: 'dashboard_type',
      description:
        'One of: overview, detail, trend, command, alarms, mode_banner, table_log. Maps to dashboard_2_* templates.',
      required: true,
    },
    { name: 'title', description: 'Page title shown in the dashboard.', required: true },
  ],
  build: (args) => {
    const kind = arg(args, 'dashboard_type', 'overview');
    const title = arg(args, 'title', 'Operator Dashboard');
    const mapping: Record<string, string> = {
      overview: 'dashboard_2_live_value',
      detail: 'dashboard_2_gauge_grid',
      trend: 'dashboard_2_telemetry_chart',
      command: 'dashboard_2_command_panel',
      alarms: 'dashboard_2_alarm_panel',
      mode_banner: 'dashboard_2_mode_banner',
      table_log: 'dashboard_2_table_log',
    };
    const template = mapping[kind] ?? 'dashboard_2_skeleton';
    return [
      `Build an ISA-101 operator dashboard.`,
      `Type: ${kind}`,
      `Title: ${title}`,
      ``,
      `1. instantiate_template('${template}') with { title: '${title}' }.`,
      `2. Wire data sources (mqtt_in, http_in, function nodes) into the widget inputs the template creates.`,
      `3. Follow ISA-101: grayscale background, color reserved for alarm/severity, trends > instantaneous values, destructive controls require confirm. Run validate_flow — the ISA-101 rules (saturated-color-outside-alarm, screen-clutter, unbounded-chart-append) will flag deviations.`,
      `4. render_flow_svg with against:'staged' (the dashboard is still staged at this point — the default would render the runtime without it), then preview_flow_diff, then deploy_staged_change (elicits confirmation).`,
    ].join('\n');
  },
};

const refactorToSubflowPrompt: FlowOtterPrompt = {
  name: 'refactor_to_subflow',
  description:
    'Refactor a set of nodes on a tab into a reusable subflow definition + instance. Use when a pattern is about to repeat.',
  arguments: [
    { name: 'tab_id', description: 'Tab id containing the nodes to refactor.', required: true },
    {
      name: 'node_ids',
      description: 'Comma-separated node ids to fold into the new subflow.',
      required: true,
    },
    { name: 'subflow_name', description: 'Name for the new subflow definition.', required: true },
  ],
  build: (args) => {
    const tab = arg(args, 'tab_id');
    const ids = arg(args, 'node_ids');
    const name = arg(args, 'subflow_name', 'NewSubflow');
    return [
      `Refactor selected nodes into a subflow.`,
      `Tab: ${tab}`,
      `Node ids: ${ids}`,
      `Subflow name: ${name}`,
      ``,
      `1. get_flow('${tab}') to inspect the current structure.`,
      `2. Identify inputs/outputs of the selected node set (which wires cross the boundary).`,
      `3. create_subflow_definition with name='${name}', nodes/connections taken from the selection, declared in/out ports matching the boundary.`,
      `4. remove_node on each of the selected ids.`,
      `5. add_subflow_instance referencing the new definition, wired to the same upstream/downstream nodes.`,
      `6. Re-run validate_flow and render_flow_svg with against:'staged' (the refactor is still staged, so the default runtime render would not show it).`,
      `7. preview_flow_diff to show me the before/after, then deploy_staged_change.`,
    ].join('\n');
  },
};

const explainMyFlowPrompt: FlowOtterPrompt = {
  name: 'explain_my_flow',
  description:
    'Generate a human-readable walkthrough of a tab: entrypoints, sinks, edges, orphans, dashboard widgets.',
  arguments: [
    { name: 'tab_id', description: 'Tab id to explain. Omit for the first tab.', required: false },
  ],
  build: (args) => {
    const tab = arg(args, 'tab_id');
    return [
      `Explain the structure of ${tab ? `tab ${tab}` : 'the current first tab'}.`,
      ``,
      `1. ${tab ? `explain_flow('${tab}')` : 'list_flows then explain_flow on the first tab'}.`,
      `2. render_flow_svg for the same tab (default against:'runtime' is correct here — explain_flow reads the deployed flows).`,
      `3. Summarize: entrypoints, sinks, key transformations, any orphan nodes, dashboard structure (if any).`,
      `4. Flag anything notable: error handling gaps, missing catch nodes, unconfirmed destructive buttons, unbounded charts.`,
    ].join('\n');
  },
};

const reviewMyFlowPrompt: FlowOtterPrompt = {
  name: 'review_my_flow',
  description:
    'Run a full review pass: analyze + validate + render + structured assessment with recommendations.',
  arguments: [
    {
      name: 'tab_id',
      description: 'Tab id to review. Omit for an all-flows review.',
      required: false,
    },
  ],
  build: (args) => {
    const tab = arg(args, 'tab_id');
    return [
      `Review ${tab ? `tab ${tab}` : 'all tabs'}.`,
      ``,
      `1. ${tab ? `analyze_flow('${tab}')` : 'analyze_all_flows()'} for structural breakdown.`,
      `2. ${tab ? `validate_flow('${tab}')` : 'validate_all_flows()'} for diagnostics.`,
      `3. ${tab ? `render_flow_svg('${tab}')` : ''}`,
      `4. Review layout against the eight layout_conventions criteria (get_authoring_guide(['layout_conventions'])); report matching validate_flow diagnostics when present.`,
      `5. Summarize: errors > warnings > info. For each, give the specific rule, the affected node, and the recommended fix.`,
      `6. If ISA-101 rules fired (saturated-color-outside-alarm, screen-clutter, unbounded-chart-append, button-group-color-decoration, dashboard-2-destructive-needs-confirm), explain the design principle behind them.`,
    ].join('\n');
  },
};

export const PROMPTS: readonly FlowOtterPrompt[] = [
  newFlowPrompt,
  buildOperatorDashboardPrompt,
  refactorToSubflowPrompt,
  explainMyFlowPrompt,
  reviewMyFlowPrompt,
];

export function findPrompt(name: string): FlowOtterPrompt | undefined {
  return PROMPTS.find((p) => p.name === name);
}
