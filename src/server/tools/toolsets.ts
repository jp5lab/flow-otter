/**
 * Toolset definitions — named groups of tools that can be enabled or
 * disabled as a unit. Lets a session start with a small surface and load
 * more tools on demand.
 *
 * The default surface excludes `author_specialists` (per Decision 1 in the
 * redesign plan: generic add_node is the workhorse, specialists are a
 * convenience layer). It also excludes `dangerous` (already env-gated by
 * ENABLE_DANGEROUS_TOOLS at the tier level).
 *
 * Each tool is in exactly one toolset. Tools NOT listed here fall into the
 * `core` toolset implicitly, so an undefined tool can never become
 * invisible by accident.
 */

export type ToolsetName =
  | 'core'
  | 'discovery'
  | 'analyze'
  | 'snapshots'
  | 'audit'
  | 'author'
  | 'author_specialists'
  | 'deploy'
  | 'dangerous';

export interface Toolset {
  readonly name: ToolsetName;
  readonly description: string;
  readonly default_enabled: boolean;
  readonly tool_names: readonly string[];
}

export const TOOLSETS: Record<ToolsetName, Toolset> = {
  core: {
    name: 'core',
    description:
      'Always-on tools: server health, target binding, toolset management. These are visible regardless of which other toolsets are enabled.',
    default_enabled: true,
    tool_names: [
      'health_check',
      'get_server_config_summary',
      'set_target',
      'clear_target',
      'list_available_toolsets',
      'enable_toolset',
    ],
  },
  discovery: {
    name: 'discovery',
    description:
      'Inventory and capability discovery tools: list flows/nodes/templates, search, browse installed node types, get_authoring_guide.',
    default_enabled: true,
    tool_names: [
      'list_flows',
      'get_flows_summary',
      'get_flow',
      'get_node',
      'search_nodes',
      'get_subflow',
      'list_installed_node_types',
      'get_runtime_state',
      'list_templates',
      'get_authoring_guide',
    ],
  },
  analyze: {
    name: 'analyze',
    description: 'Read-only analysis: explain/analyze flows, run validators, render SVG previews.',
    default_enabled: true,
    tool_names: [
      'explain_flow',
      'analyze_flow',
      'analyze_all_flows',
      'validate_flow',
      'validate_all_flows',
      'render_flow_svg',
      'render_flow_png',
    ],
  },
  snapshots: {
    name: 'snapshots',
    description:
      'Staging + snapshot lifecycle: get_staged_change, preview_flow_diff, export/list/get snapshots.',
    default_enabled: true,
    tool_names: [
      'export_snapshot',
      'list_snapshots',
      'get_snapshot',
      'get_staged_change',
      'preview_flow_diff',
    ],
  },
  audit: {
    name: 'audit',
    description: 'Audit + observability: audit log tail, debug message buffer.',
    default_enabled: true,
    tool_names: ['get_audit_log_recent', 'get_recent_debug_messages'],
  },
  author: {
    name: 'author',
    description:
      'Default authoring surface: plan_flow + generic add_node + structural tools (groups, subflows, wires, links, comments, dashboard widgets, templates). Prefer add_node over the specialist tools — it handles contrib packages first-class.',
    default_enabled: true,
    tool_names: [
      'plan_flow',
      'add_node',
      'add_subflow_instance',
      'add_group',
      'add_comment',
      'add_dashboard_widget',
      'wire_nodes',
      'set_wires',
      'set_links',
      'remove_node',
      'update_node',
      'discard_staged_change',
      'move_node',
      'update_group',
      'remove_group',
      'update_comment',
      'create_subflow_definition',
      'instantiate_template',
    ],
  },
  author_specialists: {
    name: 'author_specialists',
    description:
      'Type-specific authoring conveniences (add_inject_node, add_function_node, etc.). Default-off; enable when you want per-node-type schema validation or human-readable tool names per type. Generic add_node handles every case these do.',
    default_enabled: false,
    tool_names: [
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
    ],
  },
  deploy: {
    name: 'deploy',
    description: 'Push to live Node-RED runtime and roll back. Always-on but gated by tier.',
    default_enabled: true,
    tool_names: ['deploy_staged_change', 'rollback_last_change', 'set_flows_state'],
  },
  dangerous: {
    name: 'dangerous',
    description:
      'Explicit destructive operations (replace_flows, delete_tab, reset_runtime, create_flow, update_flow, delete_flow). Already env-gated by ENABLE_DANGEROUS_TOOLS at the tier level; this toolset adds discovery-time filtering on top.',
    default_enabled: false,
    tool_names: [
      'prepare_dangerous_operation',
      'replace_flows',
      'delete_tab',
      'reset_runtime',
      'create_flow',
      'update_flow',
      'delete_flow',
    ],
  },
};

export const DEFAULT_TOOLSETS: readonly ToolsetName[] = (
  Object.keys(TOOLSETS) as ToolsetName[]
).filter((n) => TOOLSETS[n].default_enabled);

const ALL_LISTED_TOOLS = new Set<string>();
for (const t of Object.values(TOOLSETS))
  for (const name of t.tool_names) ALL_LISTED_TOOLS.add(name);

/**
 * Resolve a tool name → its owning toolset. Tools not listed in any toolset
 * fall through to `core` (so they're always visible).
 */
export function toolsetOf(toolName: string): ToolsetName {
  for (const [name, toolset] of Object.entries(TOOLSETS) as [ToolsetName, Toolset][]) {
    if (toolset.tool_names.includes(toolName)) return name;
  }
  return 'core';
}

/**
 * Mark of safety: which tools the type system knows about. Exposed so tests
 * can verify the toolset map covers every tool registered in ALL_TOOLS.
 */
export function listedToolNames(): ReadonlySet<string> {
  return ALL_LISTED_TOOLS;
}
