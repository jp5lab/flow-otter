# Tool Reference

Tool visibility depends on tier flags. With write, deploy, and dangerous flags enabled, `ALL_TOOLS` contains 60 tools. Each tool surfaces MCP-spec annotation hints (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) on `tools/list` for client UIs (Claude Desktop, Cursor) to communicate intent.

## Read Tools

- `health_check` — also surfaces `env_name`, `persisted_target_path`, and `persisted_target_age_seconds` (null if no target.json).
- `get_server_config_summary`
- `set_target` — point the server at a Node-RED target at runtime. Discriminated input:
  - `{ base_url, ... }` (or `{ flow_source: "admin-api", base_url, ... }`) — admin-api mode.
  - `{ flow_source: "file", file_path, env_name? }` — file mode (authoring against a flat `flows.json`).
  - Always re-scopes snapshot/staging/audit storage under `~/.flow-otter/<env_name>/`.
  - `persist:true` (default) writes `~/.flow-otter/<env_name>/target.json` so the next process boot rehydrates this target. `persist:false` for ephemeral swaps.
  - **Auth tokens are NEVER persisted.** For protected runtimes, supply auth via `NODE_RED_AUTH_TOKEN` env var on the MCP registration, or re-call `set_target` with credentials each session.
- `clear_target` — remove `~/.flow-otter/<env_name>/target.json` so the next boot does NOT rehydrate. Defaults to the live `ENVIRONMENT_NAME`. Optional `revert_in_memory:true` re-points the live container to a file source (default `./flows.json`, override via `revert_file_path`).
- `list_flows` — lists all tabs (flows). Each entry exposes both `id` (Node-RED tab ID) and `authoring_key` (the `_authoringKey` extension; equal to `id` when the tab was authored outside FlowOtter). Author tools accept either form for `tab_id`.
- `get_flows_summary`
- `get_flow`
- `get_node`
- `search_nodes`
- `get_subflow`
- `list_installed_node_types` — returns Node-RED's installed modules + `typed_modules:[{type,has_schema}]` indicating which types FlowOtter has registered Zod schemas for (use with `add_node`).
- `get_runtime_state`
- `explain_flow`
- `analyze_flow`
- `analyze_all_flows`
- `validate_flow`
- `validate_all_flows`
- `render_flow_svg`
- `preview_flow_diff`
- `export_snapshot`
- `list_snapshots`
- `get_snapshot`
- `list_templates`
- `get_staged_change`
- `get_audit_log_recent`
- `get_recent_debug_messages` — recent debug-node frames captured from the active Node-RED target's `/comms` WebSocket (topic `debug` only). Lazy-connects on first call. Filters: `node_id` (exact), `flow_id` (exact), `topic_filter` (substring), `since_ms`, `limit` (most recent). Returns `{ok, connected, buffer_size, dropped_count, last_event_at, messages[]}`. Ring buffer size via `DEBUG_BUFFER_SIZE` env var (default 500, max 10 000). Returns `connected:false` and empty messages if no admin-api target is configured.

## Author Tools

Author tools stage a change. They do not deploy.

- `add_node` — **generic node-add**. Takes `{tab_id, type, opts:{passthrough?, source_node_id?, ...}}`. Validates passthrough against per-type Zod when registered (15 core types currently); accepts arbitrary passthrough for unknown types with `type_had_schema:false` hint. Preferred over the type-specific tools below for `change`, `switch`, `http in/response/request`, `csv`, `json`, `xml`, `file in/file`, `exec`, `delay`, `trigger`, `template`.
- `add_dashboard_widget` — **typed Dashboard 2.0 widget creation** for 14 widget types: `ui-dropdown`, `ui-radio-group`, `ui-slider`, `ui-switch`, `ui-text-input`, `ui-number-input`, `ui-file-input`, `ui-markdown`, `ui-progress`, `ui-audio`, `ui-spacer`, `ui-event`, `ui-link`, and dialog-mode `ui-group`. Per-widget Zod validation. Anchor resolution per widget: most need `opts.group_key`; `ui-link` uses `opts.ui_key`; `ui-event` has no anchor; `ui-group-dialog` uses `opts.page_key` and appends as a config-node.
- `add_debug_node`
- `add_inject_node`
- `add_function_node`
- `add_catch_node`
- `add_status_node`
- `add_complete_node`
- `add_mqtt_in_node`
- `add_mqtt_out_node`
- `add_link_in_node`
- `add_link_out_node`
- `add_link_call_node`
- `add_subflow_instance`
- `add_group`
- `add_comment`
- `wire_nodes`
- `set_links` — cross-tab pairing for `link out` / `link call` nodes. Input: `{source_node_id, target_node_ids:[]}`. Writes `passthrough.links` on the source to peer `link in` Node-RED ids. Pass `target_node_ids:[]` to clear. Targets may live on any tab (that's the whole point). Validates source type (`link out` or `link call`), target types (`link in`), and that each target exists in the prior compiled flows.
- `set_wires` — atomic bulk wire management. Input: `{tab_id, source_node_id, output_port?, target_node_ids:[]}`. Replaces all wires originating from `(source, output_port)` with new connections to the target keys on the same tab. Pass `target_node_ids:[]` to clear the port. Same-tab only; cross-tab wiring uses link nodes. Deduplicates targets; rejects self-wire and out-of-range output ports.
- `remove_node`
- `update_node` — full-property `passthrough` merge + **line-based `patches[]`** for token-efficient edits to string properties (function-node `func`, ui-template `format`, template `template`). Patches are `{property, op:'replace'|'insert'|'delete', start, end?, content?}` with 1-indexed line numbers on the ORIGINAL content; non-overlapping.
- `move_node`
- `create_subflow_definition`
- `instantiate_template`

## Deploy Tools

- `deploy_staged_change`
- `rollback_last_change`
- `set_flows_state` — start/stop the Node-RED flow runtime via `POST /flows/state`. Requires `runtimeState.enabled = true` in Node-RED settings.js. Use stop → deploy → start for safe rollouts against hardware-controlling flows.

`deploy_staged_change` snapshots current runtime before saving. It refuses drift unless `force:true` is supplied. `rollback_last_change` snapshots the current runtime before restoring a prior snapshot.

## Dangerous Tools

These are hidden unless `ENABLE_DANGEROUS_TOOLS=true`, `ENABLE_WRITE_TOOLS=true`, `ENABLE_DEPLOY_TOOLS=true`, `READ_ONLY_MODE=false`, and `DRY_RUN_MODE=false`.

- `prepare_dangerous_operation`
- `replace_flows`
- `delete_tab`
- `reset_runtime`
- `create_flow` — POST /flow. Creates a single new Node-RED tab atomically via the Admin API. Input: `{flow, confirmation_token}`. Bypasses staging — runtime sees the change immediately. Pre-mutation snapshot recorded for rollback. Token scope: `{operation:'create_flow', environment, actor, target:flow.label||'', flowsHash:canonicalHash(flow)}`.
- `update_flow` — PUT /flow/:id. Replaces a single tab by id. Input: `{flow_id, flow, confirmation_token}`. Bypasses staging. Pre-mutation snapshot. Token scope: `{operation:'update_flow', environment, actor, target:flow_id, flowsHash:canonicalHash(flow)}`.
- `delete_flow` — DELETE /flow/:id. Removes a single tab via the per-flow Admin endpoint. Input: `{flow_id, confirmation_token}`. Bypasses staging. Pre-mutation snapshot. Token scope: `{operation:'delete_flow', environment, actor, target:flow_id}`. Compare with `delete_tab`, which uses a full-flows POST instead.

All six destructive tools (`replace_flows`, `delete_tab`, `reset_runtime`, `create_flow`, `update_flow`, `delete_flow`) require a confirmation token from `prepare_dangerous_operation`.

## Built-In Templates

- `hello_world`
- `mqtt_to_debug`
- `inject_to_mqtt`
- `function_transform`
- `link_call_pair`
- `error_monitor`
- `status_monitor`
- `complete_monitor`
- `reusable_subflow`
- `dashboard_2_skeleton`
- `dashboard_2_status_panel`
- `dashboard_2_telemetry_chart`
- `dashboard_2_command_panel`
- `dashboard_2_form_input`
- `dashboard_2_gauge_grid`
- `dashboard_2_table_log`
- `dashboard_2_dual_theme`
- `dashboard_2_multi_page`
- `dashboard_2_template_widget`
- `dashboard_2_custom_css`
- `dashboard_2_alarm_panel` — ISA-18.2 alarm state machine + `ui-table`.
- `dashboard_2_confirmed_button` — hold-to-confirm (default 2 sec) destructive-action button.
- `dashboard_2_mode_banner` — AUTO/MANUAL + LOCAL/REMOTE + LOCKOUT indicator strip.
- `dashboard_2_live_value` — value display with stale-data badge after N sec of no update.
- `dashboard_2_audit_log_tail` — operator-visible recent actions table.
- `instrument_command_to_telemetry_pipeline`
- `parametrized_fleet_tab`
