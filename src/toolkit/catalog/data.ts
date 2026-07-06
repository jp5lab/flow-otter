/**
 * Seed data for the capability catalog. Hand-curated for concepts,
 * node types, widgets, validators, design principles, and methodology;
 * dynamically composed for templates (sourced from BUILTIN_TEMPLATES) so
 * adding a template automatically extends the catalog.
 *
 * When adding a new Node-RED core node type, dashboard widget, validator,
 * or design principle, update the relevant array here AND ensure the
 * completeness tests in tests/unit/catalog/ still pass.
 */

import { BUILTIN_TEMPLATES } from '../templates/builtin.js';

import type {
  ConceptEntry,
  DashboardWidgetEntry,
  DesignPrincipleEntry,
  LayoutConventionEntry,
  MethodologyEntry,
  NodeTypeEntry,
  TemplateEntry,
  ValidatorEntry,
} from './types.js';

export const NODE_RED_CONCEPTS: readonly ConceptEntry[] = [
  {
    name: 'tab',
    purpose:
      'Top-level workspace organizational unit (also called "flow"). Holds nodes, groups, comments. Has optional info (Markdown) and per-tab env vars.',
    flow_otter_tools: ['list_flows', 'get_flow', 'create_flow', 'update_tab'],
  },
  {
    name: 'node',
    purpose:
      'Single unit of logic. Every node has id, type, x/y position, z (parent tab), wires, name, plus type-specific config in passthrough.',
    flow_otter_tools: ['add_node', 'get_node', 'update_node', 'remove_node', 'move_node'],
  },
  {
    name: 'wire',
    purpose:
      'Connection from a node output port to a downstream node input. Fan-out clones messages; fan-in delivers separate messages.',
    flow_otter_tools: ['wire_nodes', 'set_wires'],
  },
  {
    name: 'group',
    purpose:
      'Visual container for related nodes. Supports nesting since Node-RED 3.1. Carries label, style, info, env vars.',
    flow_otter_tools: ['add_group'],
    min_node_red_version: '2.1.0',
    notes: 'Use when 3+ nodes share a logical purpose. Prefer a subflow for repeating patterns.',
  },
  {
    name: 'subflow',
    purpose:
      'Reusable encapsulated flow with declared inputs/outputs, env vars, optional status node, and module packaging.',
    flow_otter_tools: ['create_subflow_definition', 'add_subflow_instance', 'get_subflow'],
    notes:
      'Use when the same pattern repeats 2+ times. Per-instance config-node selection added in Node-RED 4.0.',
  },
  {
    name: 'link_in',
    purpose:
      'Virtual input target — receives messages from link_out nodes anywhere in the flows file (cross-tab supported).',
    flow_otter_tools: ['add_link_in_node', 'set_links'],
  },
  {
    name: 'link_out',
    purpose:
      'Virtual output source — fires to link_in targets. Supports a "return" mode that replies to the calling link_call.',
    flow_otter_tools: ['add_link_out_node', 'set_links'],
  },
  {
    name: 'link_call',
    purpose:
      'Subroutine-style invocation: sends to a target link_in, waits for a return. Supports dynamic targets via msg.target (3.0+).',
    flow_otter_tools: ['add_link_call_node', 'set_links'],
    min_node_red_version: '3.0.0',
  },
  {
    name: 'comment',
    purpose:
      'Sticky-note style annotation with Markdown info body. No runtime effect — pure documentation in the canvas.',
    flow_otter_tools: ['add_comment'],
  },
  {
    name: 'junction',
    purpose:
      'Pure visual wire-routing passthrough. No logic — used to clean up edge crossings without a function node.',
    flow_otter_tools: ['add_node'],
    min_node_red_version: '3.0.0',
    notes: 'Added in Node-RED 3.0. FlowOtter authors via generic add_node (type: "junction").',
  },
  {
    name: 'config_node',
    purpose:
      'Reusable shared config (MQTT broker, HTTP auth, TLS, etc.). Lives outside any tab; referenced by id from regular nodes.',
    flow_otter_tools: ['add_config_node'],
    notes:
      'Use add_config_node for global config nodes. FlowOtter does NOT author credentials. Per-instance overrides inside subflow instances are 4.0+.',
  },
  {
    name: 'credential',
    purpose:
      'Encrypted credential value stored in flows_cred.json (AES via credentialSecret). NEVER round-trips through editor; only has_<field>:bool exposed.',
    flow_otter_tools: [],
    notes:
      'FlowOtter does NOT author credentials. Deploy with empty credential fields; user fills them in the Node-RED editor.',
  },
];

export const CORE_NODE_TYPES: readonly NodeTypeEntry[] = [
  // Common / Input
  {
    type: 'inject',
    category: 'input',
    purpose:
      'Manual or scheduled trigger; payload from string/number/JSON/ISO timestamp/flow/global/env.',
    capabilities: ['isoTimestampInject'],
    flow_otter_specialist: 'add_inject_node',
    generic_tool: 'add_node',
    notes: 'ISO 8601 / Date timestamp formats are available in Node-RED 4.0+.',
  },
  {
    type: 'catch',
    category: 'common',
    purpose: 'Error handler scoped to all/selected/group/uncaught-only.',
    flow_otter_specialist: 'add_catch_node',
    generic_tool: 'add_node',
  },
  {
    type: 'status',
    category: 'common',
    purpose: 'Reports node status (running/error/idle) for scoped targets.',
    flow_otter_specialist: 'add_status_node',
    generic_tool: 'add_node',
  },
  {
    type: 'complete',
    category: 'common',
    purpose: 'Fires when a scoped target completes a message.',
    flow_otter_specialist: 'add_complete_node',
    generic_tool: 'add_node',
  },
  {
    type: 'link in',
    category: 'common',
    purpose: 'Virtual input from link_out nodes.',
    flow_otter_specialist: 'add_link_in_node',
    generic_tool: 'add_node',
  },
  {
    type: 'comment',
    category: 'common',
    purpose: 'Markdown annotation; no runtime behavior.',
    capabilities: ['markdownGhAlerts'],
    flow_otter_specialist: 'add_comment',
    generic_tool: 'add_node',
    notes: 'GitHub-style Markdown alerts ([!NOTE], etc.) render in Node-RED 5.0+.',
  },
  {
    type: 'junction',
    category: 'common',
    purpose: 'Visual wire-routing passthrough (3.0+).',
    min_node_red_version: '3.0.0',
    capabilities: ['junctions'],
    generic_tool: 'add_node',
    notes: 'Added in Node-RED 3.0.',
  },

  // Common / Output
  {
    type: 'debug',
    category: 'output',
    purpose: 'Output to sidebar/console/status; severity-configurable.',
    flow_otter_specialist: 'add_debug_node',
    generic_tool: 'add_node',
  },
  {
    type: 'link out',
    category: 'common',
    purpose: 'Virtual output: send or return mode.',
    flow_otter_specialist: 'add_link_out_node',
    generic_tool: 'add_node',
  },
  {
    type: 'link call',
    category: 'common',
    purpose: 'Subroutine call to link_in; waits for return. Dynamic target since 3.0.',
    min_node_red_version: '3.0.0',
    capabilities: ['linkCallNode'],
    flow_otter_specialist: 'add_link_call_node',
    generic_tool: 'add_node',
    notes: 'Link Call node + return-mode link out are gated as Node-RED 3.1+.',
  },

  // Function
  {
    type: 'function',
    category: 'function',
    purpose:
      'JavaScript handler with lifecycle tabs, external modules, ESM modules, timeouts, and node.linkcall support.',
    capabilities: [
      'functionNodePrefixModules',
      'esmNodeModules',
      'globalFunctionTimeout',
      'functionLinkCall',
    ],
    flow_otter_specialist: 'add_function_node',
    generic_tool: 'add_node',
    notes:
      'node: prefix modules and global function timeout are 4.1+; node.linkcall is 5.0.0-beta.6+; ESM node modules are 5.0 GA+.',
  },
  {
    type: 'switch',
    category: 'function',
    purpose: 'Routes messages by Value/Sequence/Expression/Otherwise rules; can be multi-output.',
    capabilities: ['jsonata2'],
    generic_tool: 'add_node',
    notes: 'JSONata expressions use JSONata 2.0 in Node-RED 4.0+.',
  },
  {
    type: 'change',
    category: 'function',
    purpose: 'Set/Change/Move/Delete msg/flow/global properties; JSONata supported.',
    capabilities: ['jsonata2'],
    generic_tool: 'add_node',
    notes: 'JSONata expressions use JSONata 2.0 in Node-RED 4.0+.',
  },
  {
    type: 'range',
    category: 'function',
    purpose: 'Map numeric input range to output range (with optional clamping).',
    generic_tool: 'add_node',
  },
  {
    type: 'template',
    category: 'function',
    purpose: 'Mustache templating; supports {{env.X}} since 3.0.',
    generic_tool: 'add_node',
  },
  {
    type: 'delay',
    category: 'function',
    purpose: 'Rate limit, fixed delay, queue, burst, or schedule message delivery.',
    capabilities: ['delayBurstMode'],
    generic_tool: 'add_node',
    notes: 'Burst mode uses pauseType:"burst" and is available in Node-RED 5.0.0-beta.2+.',
  },
  {
    type: 'trigger',
    category: 'function',
    purpose: 'Then-send / then-reset patterns with extendable timer.',
    generic_tool: 'add_node',
  },
  {
    type: 'exec',
    category: 'function',
    purpose: 'Spawn external process; capture stdout/stderr/exit code.',
    generic_tool: 'add_node',
  },
  {
    type: 'rbe',
    category: 'function',
    purpose: 'Filter (Report-By-Exception): block unless changed.',
    generic_tool: 'add_node',
  },

  // Network
  {
    type: 'mqtt in',
    category: 'network',
    purpose: 'Subscribe to MQTT broker topic; QoS 0/1/2; v3.1/v5 supported.',
    flow_otter_specialist: 'add_mqtt_in_node',
    generic_tool: 'add_node',
  },
  {
    type: 'mqtt out',
    category: 'network',
    purpose: 'Publish to MQTT broker; supports will/session/dynamic subscribe.',
    flow_otter_specialist: 'add_mqtt_out_node',
    generic_tool: 'add_node',
  },
  {
    type: 'http in',
    category: 'network',
    purpose: 'Expose HTTP endpoint; paired with http_response to reply.',
    generic_tool: 'add_node',
  },
  {
    type: 'http response',
    category: 'network',
    purpose: 'Reply to an http_in request; sets status code and body.',
    generic_tool: 'add_node',
  },
  {
    type: 'http request',
    category: 'network',
    purpose: 'Outbound HTTP request with optional digest/oauth/tls.',
    generic_tool: 'add_node',
  },
  {
    type: 'websocket in',
    category: 'network',
    purpose: 'Receive WebSocket messages.',
    generic_tool: 'add_node',
  },
  {
    type: 'websocket out',
    category: 'network',
    purpose: 'Send WebSocket messages.',
    generic_tool: 'add_node',
  },
  {
    type: 'tcp in',
    category: 'network',
    purpose: 'Listen for TCP connections; emit received data.',
    generic_tool: 'add_node',
  },
  {
    type: 'tcp out',
    category: 'network',
    purpose: 'Open or write to TCP socket.',
    generic_tool: 'add_node',
  },
  {
    type: 'tcp request',
    category: 'network',
    purpose: 'TCP request/response pattern.',
    generic_tool: 'add_node',
  },
  {
    type: 'udp in',
    category: 'network',
    purpose: 'Receive UDP datagrams.',
    generic_tool: 'add_node',
  },
  {
    type: 'udp out',
    category: 'network',
    purpose: 'Send UDP datagrams.',
    generic_tool: 'add_node',
  },

  // Sequence
  {
    type: 'split',
    category: 'sequence',
    purpose: 'Split a message into multiple by length/object-key/buffer.',
    generic_tool: 'add_node',
  },
  {
    type: 'join',
    category: 'sequence',
    purpose: 'Reassemble messages split earlier; manual/automatic/count modes.',
    generic_tool: 'add_node',
  },
  {
    type: 'sort',
    category: 'sequence',
    purpose: 'Sort a sequence by key or JSONata expression.',
    capabilities: ['jsonata2'],
    generic_tool: 'add_node',
    notes: 'JSONata expressions use JSONata 2.0 in Node-RED 4.0+.',
  },
  {
    type: 'batch',
    category: 'sequence',
    purpose: 'Group messages by count/interval/sequence.',
    generic_tool: 'add_node',
  },

  // Parser
  {
    type: 'csv',
    category: 'parser',
    purpose: 'Encode/decode CSV; RFC4180-compliant rewrite in 4.0.',
    generic_tool: 'add_node',
  },
  {
    type: 'html',
    category: 'parser',
    purpose: 'Extract elements from HTML via CSS selectors.',
    generic_tool: 'add_node',
  },
  {
    type: 'json',
    category: 'parser',
    purpose: 'Encode/decode JSON; optional schema validation.',
    generic_tool: 'add_node',
  },
  {
    type: 'xml',
    category: 'parser',
    purpose: 'Encode/decode XML.',
    generic_tool: 'add_node',
  },
  {
    type: 'yaml',
    category: 'parser',
    purpose: 'Encode/decode YAML.',
    generic_tool: 'add_node',
  },

  // Storage
  {
    type: 'file',
    category: 'storage',
    purpose: 'Write or append to file.',
    generic_tool: 'add_node',
  },
  {
    type: 'file in',
    category: 'storage',
    purpose: 'Read file from filesystem.',
    generic_tool: 'add_node',
  },
  {
    type: 'watch',
    category: 'storage',
    purpose: 'Watch filesystem path for change events.',
    generic_tool: 'add_node',
  },
];

export const DASHBOARD_2_WIDGETS: readonly DashboardWidgetEntry[] = [
  // Inputs — all supported except those marked
  {
    widget: 'ui-dropdown',
    category: 'input',
    purpose: 'Single- or multi-select dropdown.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-radio-group',
    category: 'input',
    purpose: 'Single-select radio buttons.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-slider',
    category: 'input',
    purpose: 'Numeric slider with min/max/step.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-switch',
    category: 'input',
    purpose: 'Boolean toggle switch.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-text-input',
    category: 'input',
    purpose: 'Single-line text input.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-number-input',
    category: 'input',
    purpose: 'Numeric input with optional min/max.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-file-input',
    category: 'input',
    purpose: 'File picker; emits file content as payload.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-form',
    category: 'input',
    purpose: 'Multi-field form with submit; required-field validation.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },

  // Display
  {
    widget: 'ui-text',
    category: 'display',
    purpose: 'Read-only text/HTML display; JSONata bindings.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },
  {
    widget: 'ui-markdown',
    category: 'display',
    purpose: 'Markdown + Mermaid + mustache payload bindings.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-progress',
    category: 'display',
    purpose: 'Progress bar.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-audio',
    category: 'display',
    purpose: 'Audio playback + TTS (TTS added v1.29).',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },

  // Chart / table
  {
    widget: 'ui-chart',
    category: 'chart',
    purpose:
      'Apache eCharts (since v1.27): line/bar/scatter/pie/area/histogram; time/linear/category x-axis.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support. Item 11 adds unbounded-append validator.',
  },
  {
    widget: 'ui-table',
    category: 'table',
    purpose:
      'Tabular data with Text/HTML/Link/Color/Progress/Sparkline/Button/Image cell types; built-in search.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },
  {
    widget: 'ui-gauge',
    category: 'chart',
    purpose: 'Tile/Battery/Tank/Half/3-quarter gauge; needle or rounded; colored segments.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },

  // Interaction
  {
    widget: 'ui-button',
    category: 'interaction',
    purpose: 'Click or hold-to-action button; emits payload/event.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },
  {
    widget: 'ui-button-group',
    category: 'interaction',
    purpose: 'Single-select multi-state switch (mode/state selector).',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },
  {
    widget: 'ui-event',
    category: 'interaction',
    purpose: 'Emits $pageview/$pageleave + custom events from ui-template.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page'],
  },
  {
    widget: 'ui-link',
    category: 'interaction',
    purpose: 'Sidebar external link.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base'],
  },

  // Container / config
  {
    widget: 'ui-spacer',
    category: 'container',
    purpose: 'Layout filler.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base', 'ui-page', 'ui-group'],
  },
  {
    widget: 'ui-template',
    category: 'interaction',
    purpose: 'Vue 3 custom widget + CSS escape hatch; 5 scopes.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base'],
    notes:
      'Item 9 of v1.3.0 plan adds authoring support. The power-user escape hatch for any UI not covered by built-in widgets.',
  },
  {
    widget: 'ui-control',
    category: 'config',
    purpose: 'Non-rendering programmatic UI control (show/hide, navigate).',
    flow_otter_status: 'supported',
    required_parents: ['ui-base'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },
  {
    widget: 'ui-notification',
    category: 'feedback',
    purpose: 'Toast/snackbar with confirm + dismiss; per-client by default.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base'],
    notes: 'Item 9 of v1.3.0 plan adds authoring support.',
  },
  {
    widget: 'ui-group-dialog',
    category: 'config',
    purpose: 'Dialog-style group invoked via ui-control.',
    flow_otter_status: 'supported',
    required_parents: ['ui-base'],
  },
];

/**
 * Templates are sourced from BUILTIN_TEMPLATES so the catalog auto-tracks
 * any additions. Categorization is by name prefix.
 */
/**
 * ISA-101-aligned operator-screen templates already in the codebase under
 * `dashboard_2_` names. These cover the canonical 4-level operator-UI
 * hierarchy (overview / unit control / detail / trend). The catalog
 * surfaces them under the `operator` category so the agent can find them
 * by intent instead of by name prefix.
 *
 * Mapping:
 * - operator_overview     → dashboard_2_live_value (with `units` etc.)
 * - operator_detail       → dashboard_2_gauge_grid
 * - operator_trend        → dashboard_2_telemetry_chart
 * - operator_command      → dashboard_2_command_panel + dashboard_2_confirmed_button
 * - operator_alarms       → dashboard_2_alarm_panel + dashboard_2_audit_log_tail
 * - operator_mode_banner  → dashboard_2_mode_banner
 * - operator_table_log    → dashboard_2_table_log
 */
const OPERATOR_TEMPLATE_NAMES = new Set([
  'dashboard_2_alarm_panel',
  'dashboard_2_audit_log_tail',
  'dashboard_2_command_panel',
  'dashboard_2_confirmed_button',
  'dashboard_2_gauge_grid',
  'dashboard_2_live_value',
  'dashboard_2_mode_banner',
  'dashboard_2_table_log',
  'dashboard_2_telemetry_chart',
]);

function categoriseTemplate(name: string): TemplateEntry['category'] {
  if (name.startsWith('operator_')) return 'operator';
  if (OPERATOR_TEMPLATE_NAMES.has(name)) return 'operator';
  if (name.startsWith('dashboard_2_')) return 'dashboard';
  if (
    name === 'instrument_command_to_telemetry_pipeline' ||
    name === 'parametrized_fleet_tab' ||
    name === 'reusable_subflow' ||
    name === 'link_call_pair'
  )
    return 'pipeline';
  return 'generic';
}

export const TEMPLATES: readonly TemplateEntry[] = BUILTIN_TEMPLATES.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters.map((p) => ({
    name: p.name,
    type: p.type,
    description: p.description,
    ...(p.required !== undefined ? { required: p.required } : {}),
    ...(p.default !== undefined ? { default: p.default } : {}),
  })),
  category: categoriseTemplate(t.name),
}));

export const VALIDATORS: readonly ValidatorEntry[] = [
  {
    rule: 'id-uniqueness',
    typical_severity: 'error',
    category: 'structure',
    checks: 'All node IDs are globally unique across the flow.',
  },
  {
    rule: 'wire-targets',
    typical_severity: 'error',
    category: 'structure',
    checks: 'Every wire endpoint references an existing node id with a valid output port.',
  },
  {
    rule: 'label-cap',
    typical_severity: 'warning',
    category: 'style',
    checks:
      'Node labels stay within a configurable character cap (default 24) to fit canvas rendering.',
  },
  {
    rule: 'on-grid',
    typical_severity: 'warning',
    category: 'style',
    checks: 'Node positions align to the 20px Node-RED editor grid.',
  },
  {
    rule: 'group-consistency',
    typical_severity: 'error',
    category: 'structure',
    checks: 'Groups contain only nodes located on the same tab as the group itself.',
  },
  {
    rule: 'function-syntax',
    typical_severity: 'error',
    category: 'function',
    checks: 'Function-node body parses as valid JavaScript.',
  },
  {
    rule: 'function-side-effects',
    typical_severity: 'warning',
    category: 'function',
    checks: 'Flags certain anti-patterns inside function nodes (global state, process calls).',
  },
  {
    rule: 'link-resolution',
    typical_severity: 'error',
    category: 'structure',
    checks: 'link_out and link_call nodes reference existing link_in handlers.',
  },
  {
    rule: 'subflow-ports',
    typical_severity: 'error',
    category: 'structure',
    checks: 'Subflow instances match their definition port count.',
  },
  {
    rule: 'dashboard-hierarchy',
    typical_severity: 'error',
    category: 'dashboard',
    checks: 'Legacy Dashboard 1.x hierarchy (ui_base → ui_page → ui_group → widgets).',
  },
  {
    rule: 'dashboard-2-hierarchy',
    typical_severity: 'error',
    category: 'dashboard',
    checks: 'Dashboard 2.0 hierarchy (ui-base → ui-page → ui-group → ui-theme + widgets).',
  },
  {
    rule: 'dashboard-2-required-fields',
    typical_severity: 'error',
    category: 'dashboard',
    checks: 'Dashboard 2.0 widgets have mandatory fields (e.g., maxrows for ui-table).',
  },
  {
    rule: 'dashboard-2-group-width-fits',
    typical_severity: 'warning',
    category: 'dashboard',
    checks: 'Widget layout fits within group max width on the 12-unit grid.',
  },
  {
    rule: 'dashboard-2-mixed-versions',
    typical_severity: 'error',
    category: 'dashboard',
    checks: 'Cannot mix Dashboard 1.x and 2.0 config nodes in the same flow.',
  },
  {
    rule: 'dashboard-2-destructive-needs-confirm',
    typical_severity: 'warning',
    category: 'dashboard',
    checks:
      'Destructive operations (e.g., reset, abort patterns) require an editor-confirmation property.',
  },
  {
    rule: 'tab-divergence',
    typical_severity: 'warning',
    category: 'structure',
    checks: 'Tab content has not silently drifted from the deployed baseline.',
  },
  {
    rule: 'naming-contract',
    typical_severity: 'warning',
    category: 'naming',
    checks: 'Node names conform to an optional custom naming schema (severity per-contract).',
  },
  {
    rule: 'credential-leak',
    typical_severity: 'error',
    category: 'security',
    checks:
      'Detects bare API keys / passwords / tokens stuffed into visible (non-credential) node fields.',
  },
  {
    rule: 'version-compat',
    typical_severity: 'warning',
    category: 'structure',
    checks:
      'Version-gated features (delay burst mode, tls-config pfx/env cert modes, node:-prefixed function libs, node.linkcall) are supported by the target Node-RED runtime; silent when no runtime info is available (file mode).',
  },
  // ISA-101 enforcement validators (added v1.3.0):
  {
    rule: 'unbounded-chart-append',
    typical_severity: 'warning',
    category: 'dashboard',
    checks:
      "Dashboard 2.0 ui-chart with action:'append' must set xAxisLimit to prevent unbounded data growth.",
  },
  {
    rule: 'screen-clutter',
    typical_severity: 'warning',
    category: 'dashboard',
    checks:
      'Flags ui-group with >12 widgets and ui-page with >6 groups — operator-screen density limits.',
  },
  {
    rule: 'saturated-color-outside-alarm',
    typical_severity: 'warning',
    category: 'dashboard',
    checks:
      'ISA-101 grayscale-90%: detects saturated hex colors (HSL saturation >0.6) on widget fields outside alarm context.',
  },
  {
    rule: 'button-group-color-decoration',
    typical_severity: 'info',
    category: 'dashboard',
    checks:
      'ui-button-group with 3+ options each using a different color — color-as-decoration anti-pattern per ISA-101.',
  },
];

export const DESIGN_PRINCIPLES: readonly DesignPrincipleEntry[] = [
  {
    name: 'isa_101_grayscale_90',
    domain: 'operator_dashboard',
    rule: 'Reserve color for severity/alarm signal. Normal-state UI uses muted grays and off-whites.',
    rationale:
      'ISA-101 operator-UI principle. Saturation should mean "this needs attention," not decoration.',
  },
  {
    name: 'isa_101_color_as_severity',
    domain: 'operator_dashboard',
    rule: 'Red=critical, magenta=danger, orange=high alarm, yellow=low/warning, amber=forced. Green only when its absence would confuse.',
    rationale:
      'ISA-101 standard alarm-color mapping. Consistent palette across screens lets operators recognize severity at a glance.',
  },
  {
    name: 'operator_4_level_hierarchy',
    domain: 'operator_dashboard',
    rule: 'Level 1 = Plant Overview, Level 2 = Unit Control, Level 3 = Detail (single-asset), Level 4 = Diagnostic/Trend.',
    rationale:
      'Operator navigation is more efficient when each screen maps to one of four canonical levels rather than a flat list.',
  },
  {
    name: 'trends_over_instantaneous',
    domain: 'operator_dashboard',
    rule: 'Pair every critical KPI with a sparkline. "Is it changing?" matters more than "what is it right now?"',
    rationale:
      'Trend pattern recognition is faster than reading a digit. Used in process control since the analog-strip-chart era.',
  },
  {
    name: 'affordance_asymmetry',
    domain: 'operator_dashboard',
    rule: 'Read views look read-only (no borders, no buttons). Control views explicitly group commands and require confirm.',
    rationale: 'Reduces accidental commands. Visual styling carries semantics.',
  },
  {
    name: 'destructive_command_confirm',
    domain: 'operator_dashboard',
    rule: 'Destructive payloads ({abort, kill, trip, purge, shutdown, halt, e-stop, reset}) require explicit confirmation.',
    rationale: 'ISA-18.2 §11.13. Single-click destructive actions cause real incidents.',
    enforced_by: ['dashboard-2-destructive-needs-confirm'],
  },
  {
    name: 'unbounded_chart_anti_pattern',
    domain: 'operator_dashboard',
    rule: 'ui-chart in append mode must set xAxisLimit to bound history retention.',
    rationale:
      'Unbounded append leads to unbounded memory growth in the client. Operators rarely need >24h in-browser.',
  },
  {
    name: 'screen_clutter_limits',
    domain: 'operator_dashboard',
    rule: 'No more than ~12 widgets per group or ~6 groups per page.',
    rationale:
      'Operator working memory is limited. More density → slower scanning → worse decisions.',
  },
];

/**
 * The eight layout-readability criteria from the 2026-06-10 layout audit,
 * with numbers. `lint_rule` ids are frozen by the fix plan (D-1/D-2) and
 * register with the v1.5.0 layout lint — see LayoutConventionEntry.
 */
export const LAYOUT_CONVENTIONS: readonly LayoutConventionEntry[] = [
  {
    criterion: 'lifecycle_left_to_right',
    convention:
      'Signal lifecycle reads left-to-right: acquire → condition → decide → act → indicate. Stage columns advance at a 140-220px pitch.',
    lint_rule: 'layout-stage-order',
  },
  {
    criterion: 'stages_visually_grouped',
    convention:
      'Wrap each lifecycle stage in a group (add_group); sibling group boxes must not overlap.',
    lint_rule: 'layout-group-overlap',
  },
  {
    criterion: 'stage_headers',
    convention:
      'Every group of 3+ members carries a name or a header comment placed above the group box.',
    lint_rule: 'layout-header-presence',
  },
  {
    criterion: 'error_lane_below',
    convention:
      'Error handling (catch/status/complete chains) sits in a lane BELOW the happy path, at least 120px below it (the lane gap).',
    lint_rule: 'layout-error-lane-below',
  },
  {
    criterion: 'affirmative_output_on_top',
    convention:
      'Switch port 0 (the affirmative/first rule) wires to the topmost branch; port order top-to-bottom mirrors rule order.',
    lint_rule: 'layout-affirmative-on-top',
  },
  {
    criterion: 'minimal_wire_crossings',
    convention:
      'Minimize wire crossings; reroute long or crossing wires through junctions or link nodes.',
    lint_rule: 'layout-wire-crossings',
  },
  {
    criterion: 'no_backward_wires',
    convention:
      'Wires flow left-to-right: a wire whose target sits left of its source port (20px tolerance) is a backward wire.',
    lint_rule: 'layout-backward-wires',
  },
  {
    criterion: 'grid_aligned_within_viewport',
    convention:
      'Positions snap to the 20px grid; keep the whole tab within the ~1420px visible viewport (1920px window − 180px palette − 320px sidebar).',
    lint_rule: 'layout-viewport-overflow',
    notes:
      'Grid alignment and node overlap are already machine-checked today by the on-grid validator and the bbox-overlap lint rule.',
  },
];

export const METHODOLOGY: MethodologyEntry = {
  phases: [
    {
      name: 'scope',
      description: 'Restate goal in 3-7 logical stages. LLM semantic-reasoning strength.',
      tools: ['plan_flow'],
    },
    {
      name: 'capacity',
      description:
        'Estimate node count per stage. If total > 15 OR any stage > 5, organize aggressively.',
      tools: ['plan_flow'],
    },
    {
      name: 'organize',
      description:
        'Apply the organize decision tree before adding any nodes. Subflows for repeats, groups for affinity, link nodes for distance, tabs for independence.',
      tools: [
        'create_subflow_definition',
        'add_group',
        'add_link_in_node',
        'add_link_out_node',
        'add_link_call_node',
      ],
    },
    {
      name: 'structure',
      description:
        'Add nodes (without wires) and any shared config nodes. Use generic add_node by default for canvas nodes.',
      tools: [
        'add_node',
        'add_config_node',
        'add_subflow_instance',
        'add_dashboard_widget',
        'add_comment',
      ],
    },
    {
      name: 'wire',
      description: 'Connect with wire_nodes / set_wires / set_links.',
      tools: ['wire_nodes', 'set_wires', 'set_links'],
    },
    {
      name: 'layout',
      description:
        'Explicit visual layout pass — automatic layout is not exposed as an MCP tool yet. Use node positions, move_node, and add_group geometry per the eight layout_conventions criteria: 20px grid, 140-220px column pitch left-to-right, error lane 120px BELOW the happy path, switch port 0 on top, ~1420px visible viewport.',
      tools: ['move_node', 'add_group', 'render_flow_svg', 'render_flow_png'],
    },
    {
      name: 'review',
      description:
        'Render (render_flow_png returns png_path — read the file) and show the user. Elicit confirmation before deploy.',
      tools: ['render_flow_svg', 'render_flow_png', 'analyze_flow', 'explain_flow'],
    },
    {
      name: 'validate',
      description:
        'Run validators; preview diff; deploy with confirmation. Roll back if anything looks wrong.',
      tools: ['validate_flow', 'preview_flow_diff', 'deploy_staged_change', 'rollback_last_change'],
    },
  ],
  organize_decision_tree: [
    {
      trigger: 'Same pattern would appear 2+ times.',
      action:
        'Create a subflow definition (create_subflow_definition) and instantiate it (add_subflow_instance).',
    },
    {
      trigger: 'Multiple nodes share one logical purpose.',
      action: 'Wrap them in a group (add_group). Groups can be nested.',
    },
    {
      trigger: 'A wire would span tabs OR cross a long visual distance.',
      action: 'Use add_link_out_node + add_link_in_node (no wire crosses).',
    },
    {
      trigger: 'A stage is independent and has its own runtime state.',
      action: 'Put it on a new tab (create_flow).',
    },
    {
      trigger: 'You want a subroutine pattern (request → reply).',
      action: 'Use add_link_call_node + add_link_in_node + add_link_out_node (return mode).',
    },
  ],
};
