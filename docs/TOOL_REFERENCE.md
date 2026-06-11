# Tool Reference

Tool visibility depends on (a) tier flags and (b) **toolsets** (v1.3.0+). The default visible surface is ~48 tools; calling `enable_toolset('author_specialists')` reveals the 11 type-specific `add_*_node` conveniences (66 tools total). Dangerous tools require both `ENABLE_DANGEROUS_TOOLS=true` AND the `dangerous` toolset (auto-enabled when the env flag is set, +7 tools).

Each tool surfaces MCP-spec annotation hints (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) on `tools/list` for client UIs (Claude Desktop, Cursor) to communicate intent.

## Toolsets (progressive disclosure)

FlowOtter groups its tools into 9 named toolsets. Default-on: `core`, `discovery`, `analyze`, `snapshots`, `audit`, `author`, `deploy`. Default-off: `author_specialists`, `dangerous`. The agent can introspect via `list_available_toolsets` and load additional sets via `enable_toolset(name)`.

The full mapping lives in `src/server/tools/toolsets.ts`; tools below are listed by the most natural grouping (some `core` tools also appear under `discovery` for readability).

## Discovery + capability tools

- `list_available_toolsets` — lists all toolsets and which are enabled in the current session.
- `enable_toolset` — enables a non-default toolset (e.g., `author_specialists`).
- `get_authoring_guide` — returns the FlowOtter **capability catalog**: Node-RED concepts, core node types (with `is_core: bool` distinguishing them from contrib packages), Dashboard 2.0 widgets (with `flow_otter_status: supported|missing|partial`), built-in templates, validators, ISA-101 design principles, and the 8-phase authoring methodology. Filter via `categories` to load only what you need.

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
- `list_installed_node_types` — returns Node-RED's installed modules + `typed_modules:[{type, has_schema, is_core}]`. `has_schema` indicates FlowOtter has a typed Zod schema registered for the type (use the specialist tool when this is true); `is_core` indicates the type is in FlowOtter's core node-type catalog vs. installed via a `node-red-contrib-*` package (the long tail: Modbus, InfluxDB, OPC UA, etc.) — generic `add_node` works for everything.
- `get_runtime_state`
- `explain_flow`
- `analyze_flow`
- `analyze_all_flows`
- `validate_flow`
- `validate_all_flows`
- `render_flow_svg` — deterministic SVG of one tab. `against: 'staged' | 'runtime'` (default `'runtime'`) selects the source: `'staged'` renders the pending staged change (fails with a `staging/no-staged-change` diagnostic when the slot is empty); `'runtime'` renders the deployed flows, which never include a pending stage. Output carries `against`, `staged_hash`, and `based_on_snapshot_hash` (both null for runtime renders); for staged renders `rev` is the runtime rev the stage was computed against (= `get_staged_change`'s `based_on_rev`).
- `render_flow_png` (v1.4.0+) — renders one tab to a PNG **file on disk** and returns `png_path` + `width_px`/`height_px`: read the file to actually SEE the flow (no external SVG→PNG converter recipe needed — that workflow is dead). Mirrors `render_flow_svg`'s `against` contract exactly (same default, same `staging/no-staged-change` empty-slot diagnostic, same `staged_hash`/`based_on_snapshot_hash`/`rev` provenance). Extras: `scale` (≤4) zooms the render; `include_geometry: true` adds the `renderGeometry` per-object `{id, kind, x, y, w, h, ports[]}` array; `output_path` (absolute, inside home or tmp) overrides the default `RENDER_DIR/render-<tab_id>-<against>.png` (atomic overwrite per render); `return_image: true` appends an inline base64 `image/png` content block (opt-in — file-reading clients like Claude Code should use `png_path` instead). Text rasterizes with a bundled OFL Inter subset (never system fonts), so output is byte-stable across machines. Requires the optional `@resvg/resvg-js` dependency: when it is missing the tool fails loudly with `RasterizerUnavailableError` (never silently returns SVG); probe `health_check.rasterizer_available` first.
- `preview_flow_diff`
- `export_snapshot`
- `list_snapshots`
- `get_snapshot`
- `list_templates`
- `get_staged_change` — metadata for the pending staged change (or `staged: null`). Canonical fields are snake_case: `staged_hash` (feeds `deploy_staged_change` without renaming), `based_on_snapshot_hash`, `based_on_rev`, `staged_at`, `actor`, `reason`, plus `agent_id` (session that staged it; null pre-v0.6.0), `owned_by_current_session` (false ⇒ deploy/discard needs `force_takeover:true`), `stale` (true ⇒ staged bytes already match the runtime, so the next author op auto-clears it; null when the runtime is unreachable), and `render` (v1.4.0+: the before/after render-path block emitted when this change was staged, re-served only while its `staged_hash` still matches the pending stage; null otherwise). The camelCase duplicates (`stagedHash`, `basedOnSnapshotHash`, `basedOnRev`, `stagedAt`) are deprecated dual-emits slated for removal in v2.0.0. See `CLIENT_CONFIG.md` § Staging ownership.
- `get_audit_log_recent`
- `get_recent_debug_messages` — recent debug-node frames captured from the active Node-RED target's `/comms` WebSocket (topic `debug` only). Lazy-connects on first call. Filters: `node_id` (exact), `flow_id` (exact), `topic_filter` (substring), `since_ms`, `limit` (most recent). Returns `{ok, connected, buffer_size, dropped_count, last_event_at, messages[]}`. Ring buffer size via `DEBUG_BUFFER_SIZE` env var (default 500, max 10 000). Returns `connected:false` and empty messages if no admin-api target is configured.

### Health output (v1.3.0+)

`health_check` returns an optional `runtime: { name, version, is_prerelease, node_js_version?, detected_at, capabilities: Record<string,boolean> }` block when the target is admin-api and the `/settings` probe succeeded. Capability keys gate version-specific features (e.g., `functionLinkCall` is 5.0+, `subflowPerInstanceConfig` is 4.0+, `adminCorsDefault` is pre-5.0). The probe is lazy-cached and invalidated on `set_target`.

Since v1.4.0 `health_check` also returns `rasterizer_available: boolean` — whether the optional `@resvg/resvg-js` dependency is loadable, i.e. whether `render_flow_png` will work (when false, PNG tools hard-fail with `RasterizerUnavailableError`; there is no silent SVG fallback).

## Author Tools

Author tools stage a change. They do not deploy.

Every successful stage output carries a `render` block (v1.4.0+): before/after preview paths for each tab the stage touched — `{rasterizer_available, tabs:[{tab_id, before_svg, after_svg, before_png, after_png}]}`. SVGs are always written; PNGs only when the optional `@resvg/resvg-js` rasterizer is installed (otherwise the `*_png` fields are null and `rasterizer_available` is false — absence is loud, never a silent SVG substitution). Read `after_png` (or `after_svg`) to SEE what you just staged without spending another tool call. Files live under `RENDER_DIR` (`stage-<tab>-before/after.svg/.png`, overwritten per stage); a side absent because the tab was created/removed is null. Render problems never fail the stage — the output then carries `render: null`.

- `plan_flow` (v1.3.0+) — **methodology spine**. Takes `{goal, stages[]}` where each stage declares `{name, purpose, estimated_nodes, organization, organization_rationale}`. Returns `plan_id`, explicit visual-layout guidance (`layout_strategy: "manual"` until a real `layout_flow` tool exists), and ordered `next_actions[]` referencing real tool calls. Writes `~/.flow-otter/<env>/staging/plan.json` so soft-nudge guidance can detect "agent started authoring without planning."
- `add_node` — **generic node-add**. Takes `{tab_id, type, opts:{passthrough?, source_node_id?, ...}}`. Validates passthrough against per-type Zod when registered (26 core types incl. inject/debug/function/mqtt/link/catch/status/complete); when `passthrough` is omitted and the schema's defaults satisfy it, runtime-required defaults (e.g. inject `repeat`, complete `scope`) are materialized automatically. Accepts arbitrary passthrough for unknown types with `type_had_schema:false` hint. **Preferred default** — handles every Node-RED core type AND the long tail of `node-red-contrib-*` packages (Modbus, InfluxDB, OPC UA, BACnet, S7, etc.) first-class. Use specialist tools from `author_specialists` only when type-specific schema validation matters.
- `add_dashboard_widget` — **typed Dashboard 2.0 widget creation** for 24 widget types: inputs (`ui-dropdown`, `ui-radio-group`, `ui-slider`, `ui-switch`, `ui-text-input`, `ui-number-input`, `ui-file-input`, `ui-form`), displays (`ui-text`, `ui-markdown`, `ui-progress`, `ui-audio`), chart/table (`ui-chart`, `ui-table`, `ui-gauge`), interaction (`ui-button`, `ui-button-group`, `ui-template`, `ui-event`, `ui-link`), container/config (`ui-spacer`, `ui-control`, `ui-notification`, `ui-group-dialog`). Per-widget Zod validation; ISA-101 hooks (`confirm`, `confirmMessage`, `xAxisLimit`) are accepted and enforced by the ISA-101 validators. Anchor resolution per widget: most need `opts.group_key`; `ui-link`/`ui-control`/`ui-notification` use `opts.ui_key`; `ui-event` has no anchor; `ui-group-dialog` uses `opts.page_key`.
- `add_subflow_instance`
- `add_group` — creates a visual group on a tab. Supports `node_keys`, `position`, `size`, `parent_key`, `info`, and `style` so agents can sketch readable Node-RED sections before programming node internals.
- `add_comment`
- `wire_nodes`
- `set_links` — cross-tab pairing for `link out` / `link call` nodes. Input: `{source_node_id, target_node_ids:[]}`. Writes `passthrough.links` on the source to peer `link in` Node-RED ids. Pass `target_node_ids:[]` to clear. Targets may live on any tab (that's the whole point). Validates source type (`link out` or `link call`), target types (`link in`), and that each target exists in the prior compiled flows.
- `set_wires` — atomic bulk wire management. Input: `{tab_id, source_node_id, output_port?, target_node_ids:[]}`. Replaces all wires originating from `(source, output_port)` with new connections to the target keys on the same tab. Pass `target_node_ids:[]` to clear the port. Same-tab only; cross-tab wiring uses link nodes. Deduplicates targets; rejects self-wire and out-of-range output ports.
- `remove_node`
- `update_node` — full-property `passthrough` merge + **line-based `patches[]`** for token-efficient edits to string properties (function-node `func`, ui-template `format`, template `template`). Patches are `{property, op:'replace'|'insert'|'delete', start, end?, content?}` with 1-indexed line numbers on the ORIGINAL content; non-overlapping.
- `move_node` — repositions a node and/or moves it to another tab. Takes `tab_id` (the tab currently holding the node — the same parameter vocabulary as every other author tool) plus optional `dest_tab_id` and `position`. `source_tab_id` is a DEPRECATED alias of `tab_id` (kept for back-compat, removal slated for v2.0.0); using it triggers the `param-vocabulary` soft nudge.
- `create_subflow_definition`
- `instantiate_template`
- `discard_staged_change` — clears the pending staged change WITHOUT deploying. Author tools refuse to stage over an undeployed change (staging is single-slot; a second op would silently discard the first), so the loop is: stage → deploy (or discard) → stage. Optional `staged_hash` asserts which stage you're discarding; `force_takeover:true` discards a stage authored by a different agent process.

**Single-slot staging contract:** every author tool stages exactly one change computed against the live runtime. If a stage is already pending, author tools refuse with a pointer to `deploy_staged_change` / `discard_staged_change` — nothing is ever silently overwritten.

### Author specialists (opt-in via `enable_toolset('author_specialists')`)

Typed conveniences for high-value core Node-RED patterns. Hidden by default — call `enable_toolset('author_specialists')` to load them, or use the equivalent `add_node({type, ...})` call without enabling the toolset.

- `add_debug_node`, `add_inject_node`, `add_function_node`, `add_catch_node`, `add_status_node`, `add_complete_node`, `add_mqtt_in_node`, `add_mqtt_out_node`, `add_link_in_node`, `add_link_out_node`, `add_link_call_node`.

## Deploy Tools

- `deploy_staged_change` — **elicits user confirmation via MCP before deploying** (v1.3.0+). When the MCP client supports elicitation (Claude Code v2.1.76+), the tool sends a JSON-Schema confirm form naming the staged hash and target. Clients without elicitation support pass `confirm:true` after the user approves — **consent only; the drift check stays fully active**. `force:true` is the separate drift OVERRIDE (deploy even though the runtime changed since staging — overwrites concurrent edits; implies consent; prefer `confirm`). Consent and drift-override are deliberately distinct flags: an earlier design used `force` for both, which silently disabled drift protection for every scripted/SDK client (found by live evaluation 2026-06-10). Snapshots the runtime first, retries on rev-mismatch, recovers from partial-deploy via post-hoc hash verification.
- `rollback_last_change`
- `set_flows_state` — start/stop the Node-RED flow runtime via `POST /flows/state`. Requires `runtimeState.enabled = true` in Node-RED settings.js. Use stop → deploy → start for safe rollouts against hardware-controlling flows.

`rollback_last_change` snapshots the current runtime before restoring a prior snapshot.

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

27 templates ship with FlowOtter. The catalog (`get_authoring_guide(['templates'])`) categorizes them as `generic`, `dashboard`, `operator`, or `pipeline`.

### Generic

- `hello_world`
- `mqtt_to_debug`
- `inject_to_mqtt`
- `function_transform`
- `link_call_pair`
- `error_monitor`
- `status_monitor`
- `complete_monitor`
- `reusable_subflow`

### Dashboard 2.0 (general)

- `dashboard_2_skeleton`
- `dashboard_2_status_panel`
- `dashboard_2_form_input`
- `dashboard_2_dual_theme`
- `dashboard_2_multi_page`
- `dashboard_2_template_widget`
- `dashboard_2_custom_css`

### Operator-grade (ISA-101-aligned, surfaced as `category: 'operator'` in the catalog)

- `dashboard_2_telemetry_chart` — time-axis chart with append + history pruning.
- `dashboard_2_command_panel` — command interface, paired with confirm widgets.
- `dashboard_2_gauge_grid` — four-gauge process-metrics grid.
- `dashboard_2_table_log` — operator-visible table.
- `dashboard_2_alarm_panel` — ISA-18.2 alarm state machine + `ui-table`.
- `dashboard_2_confirmed_button` — hold-to-confirm (default 2 sec) destructive-action button.
- `dashboard_2_mode_banner` — AUTO/MANUAL + LOCAL/REMOTE + LOCKOUT indicator strip.
- `dashboard_2_live_value` — value display with stale-data badge after N sec of no update.
- `dashboard_2_audit_log_tail` — operator-visible recent actions table.

### Pipeline

- `instrument_command_to_telemetry_pipeline`
- `parametrized_fleet_tab`

## Validators (v1.3.0: 22 total)

`validate_flow` / `validate_all_flows` run the full validator suite. The `get_authoring_guide(['validators'])` catalog enumerates each rule with severity and category. Notable v1.3.0 additions for operator-screen design:

- `unbounded-chart-append` (warning) — `ui-chart` with `action:'append'` must set `xAxisLimit`.
- `screen-clutter` (warning) — flags `>12 widgets/group` and `>6 groups/page`.
- `saturated-color-outside-alarm` (warning) — hex colors with HSL saturation `>0.6` on widget color fields outside alarm context.
- `button-group-color-decoration` (info) — `ui-button-group` with 3+ options each using a unique color.

The existing `dashboard-2-destructive-needs-confirm` validator catches destructive-payload buttons without confirmation widgets in the same group.

## MCP prompts (slash commands)

5 prompts surface as `/mcp__flow-otter__<name>` in Claude Code (and equivalent menus in other MCP clients):

- `new_flow(goal, template?)` — full plan → wire → deploy walkthrough.
- `build_operator_dashboard(dashboard_type, title)` — maps 7 dashboard types to operator templates.
- `refactor_to_subflow(tab_id, node_ids, subflow_name)` — fold selected nodes into a subflow.
- `explain_my_flow(tab_id?)` — structured walkthrough.
- `review_my_flow(tab_id?)` — full review with ISA-101 explanations.
