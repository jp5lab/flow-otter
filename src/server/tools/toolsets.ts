/**
 * Toolset definitions — named groups of tools that can be enabled or
 * disabled as a unit. Lets a session start with a small surface and load
 * more tools on demand.
 *
 * The default surface is intentionally small: core plumbing plus the
 * intent-shaped author/review/deploy path. Older broad and per-op toolsets
 * can be hidden from tools/list while remaining callable during their
 * deprecation window.
 *
 * Each tool is in exactly one toolset. Tools NOT listed here fall into the
 * `core` toolset implicitly, so an undefined tool can never become
 * invisible by accident.
 */

export type ToolsetName =
  | 'core'
  | 'essentials'
  | 'discovery'
  | 'analyze'
  | 'snapshots'
  | 'audit'
  | 'author'
  | 'author_specialists'
  | 'layout'
  | 'spec_authoring'
  | 'deploy'
  | 'dangerous';

export interface ToolsetDemotion {
  readonly since: '2.0.0';
  readonly superseded_by: string;
  readonly removal: 'no earlier than 2.2.0';
}

export interface Toolset {
  readonly name: ToolsetName;
  readonly description: string;
  readonly default_enabled: boolean;
  readonly callable_when_disabled: boolean;
  readonly demotion?: ToolsetDemotion;
  readonly tool_names: readonly string[];
}

const DEMOTED_SURFACE_DEMOTION: ToolsetDemotion = {
  since: '2.0.0',
  superseded_by: 'essentials surface + enable_toolset on demand',
  removal: 'no earlier than 2.2.0',
};

export const TOOLSETS: Record<ToolsetName, Toolset> = {
  core: {
    name: 'core',
    description:
      'Always-on tools: server health, target binding, toolset management. These are visible regardless of which other toolsets are enabled.',
    default_enabled: true,
    callable_when_disabled: false,
    tool_names: [
      'health_check',
      'set_target',
      'clear_target',
      'list_available_toolsets',
      'enable_toolset',
    ],
  },
  essentials: {
    name: 'essentials',
    description:
      'Default read/review surface: guide, flow browse, validation, PNG rendering, staged-change inspection, and diff preview.',
    default_enabled: true,
    callable_when_disabled: false,
    tool_names: [
      'get_authoring_guide',
      'list_flows',
      'get_flow',
      'validate_flow',
      'render_flow_png',
      'preview_flow_diff',
      'get_staged_change',
    ],
  },
  discovery: {
    name: 'discovery',
    description:
      'Demoted inventory and capability discovery tools. Hidden by default since 2.0.0, still callable during the deprecation window; enable_toolset("discovery") to re-list.',
    default_enabled: false,
    callable_when_disabled: true,
    demotion: DEMOTED_SURFACE_DEMOTION,
    tool_names: [
      'get_server_config_summary',
      'get_flows_summary',
      'get_node',
      'search_nodes',
      'get_subflow',
      'list_installed_node_types',
      'get_runtime_state',
      'list_templates',
    ],
  },
  analyze: {
    name: 'analyze',
    description:
      'Demoted read-only analysis tools. Hidden by default since 2.0.0, still callable during the deprecation window; enable_toolset("analyze") to re-list.',
    default_enabled: false,
    callable_when_disabled: true,
    demotion: DEMOTED_SURFACE_DEMOTION,
    tool_names: [
      'explain_flow',
      'analyze_flow',
      'analyze_all_flows',
      'validate_all_flows',
      'render_flow_svg',
    ],
  },
  snapshots: {
    name: 'snapshots',
    description:
      'Demoted snapshot lifecycle tools. Hidden by default since 2.0.0, still callable during the deprecation window; enable_toolset("snapshots") to re-list.',
    default_enabled: false,
    callable_when_disabled: true,
    demotion: DEMOTED_SURFACE_DEMOTION,
    tool_names: ['export_snapshot', 'list_snapshots', 'get_snapshot'],
  },
  audit: {
    name: 'audit',
    description:
      'Demoted audit and observability tools. Hidden by default since 2.0.0, still callable during the deprecation window; enable_toolset("audit") to re-list.',
    default_enabled: false,
    callable_when_disabled: true,
    demotion: DEMOTED_SURFACE_DEMOTION,
    tool_names: ['get_audit_log_recent', 'get_recent_debug_messages'],
  },
  author: {
    name: 'author',
    description:
      'Demoted per-op authoring tools. Hidden by default since 2.0.0, still callable during the deprecation window; default authoring is stage_spec / stage_changes. Enable_toolset("author") to re-list per-op editing tools.',
    default_enabled: false,
    callable_when_disabled: true,
    demotion: {
      since: '2.0.0',
      superseded_by: 'stage_spec / stage_changes (enable_toolset("author") for per-op editing)',
      removal: 'no earlier than 2.2.0',
    },
    tool_names: [
      'add_node',
      'add_config_node',
      'add_subflow_instance',
      'add_group',
      'add_comment',
      'add_dashboard_widget',
      'wire_nodes',
      'set_wires',
      'set_links',
      'remove_node',
      'update_node',
      'update_tab',
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
    callable_when_disabled: false,
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
  layout: {
    name: 'layout',
    description:
      'Default layout authoring: layout_flow stages deterministic geometry-only changes. The S6 evaluation gate passed, so this toolset is default-on.',
    default_enabled: true,
    callable_when_disabled: false,
    tool_names: ['layout_flow'],
  },
  spec_authoring: {
    name: 'spec_authoring',
    description:
      'Default declarative authoring: stage_spec stages geometry-free AuthoringSpec JSON, validate_spec previews computed-placement diagnostics, plan_flow shapes larger work, and stage_changes batches explicit ops. The S6 evaluation gate passed, so this toolset is default-on.',
    default_enabled: true,
    callable_when_disabled: false,
    tool_names: [
      'stage_spec',
      'validate_spec',
      'plan_flow',
      'stage_changes',
      'discard_staged_change',
    ],
  },
  deploy: {
    name: 'deploy',
    description: 'Push to live Node-RED runtime and roll back. Always-on but gated by tier.',
    default_enabled: true,
    callable_when_disabled: false,
    tool_names: ['deploy_staged_change', 'rollback_last_change', 'set_flows_state'],
  },
  dangerous: {
    name: 'dangerous',
    description:
      'Explicit destructive operations (replace_flows, delete_tab, reset_runtime, create_flow, update_flow, delete_flow). Already env-gated by ENABLE_DANGEROUS_TOOLS at the tier level; this toolset adds discovery-time filtering on top.',
    default_enabled: false,
    callable_when_disabled: false,
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
