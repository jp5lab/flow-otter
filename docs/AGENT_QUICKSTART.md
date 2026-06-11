# Agent Quickstart

How an AI agent drives FlowOtter from a cold start to a verified change on a live Node-RED instance.

## The author loop

For flows of >10 nodes or operator dashboards, the v1.3.0 methodology layer expects the agent to follow a 4-phase pipeline:

```
PLAN: plan_flow (decompose the goal into stages, choose organization)
ORGANIZE: decision tree — group vs subflow vs link node vs separate tab
STRUCTURE → WIRE → LAYOUT: add nodes, wire, then refine explicit positions/groups
REVIEW → VALIDATE → DEPLOY: render_flow_svg + validate_flow + preview_flow_diff + deploy_staged_change (elicits confirmation)
```

For small flows the short author loop still applies:

```
set_target → stage author op → preview_flow_diff → deploy_staged_change
           → get_recent_debug_messages → rollback_last_change (if needed)
           → clear_target
```

Every author tool returns a `staged_hash` and a `diff_summary`. Every deploy returns `deployed_hash` and snapshot ids. Rollback restores the prior snapshot.

## Discovery (first thing to do in a session)

Call `get_authoring_guide` once per session for the capability catalog (node types, Dashboard 2.0 widgets, templates, validators, ISA-101 design principles, the eight numeric layout conventions, methodology). The catalog tells you what's possible without trial-and-error against tool descriptions. Filter via `categories` to load only what you need — `layout_conventions` carries the layout numbers (20px grid, 140-220px column pitch, error lane ≥120px below, switch port 0 on top, ~1420px visible viewport).

Call `list_available_toolsets` to see which toolsets are currently visible. The default surface includes the most common authoring tools; load `author_specialists` to access typed `add_<type>_node` conveniences:

```jsonc
{ "tool": "enable_toolset", "arguments": { "name": "author_specialists" } }
```

## Minimal session

### 1. Point the server at a Node-RED runtime

```jsonc
// tools/call set_target
{
  "base_url": "http://192.168.1.10:1880",
  "env_name": "lab",
  // "auth_token": "...",                  // optional Bearer
  // "username": "...", "password": "..."  // optional password grant
  // "auth_env_var": "MY_TOKEN"            // recommended for persisted targets
}
```

The server re-scopes snapshots / staging / audit to `~/.flow-otter/lab/`. By default the target is persisted to `target.json` so the next process boot reads it back automatically. Pass `persist: false` for ephemeral swaps.

### 2. Inspect the runtime

```jsonc
{ "tool": "list_flows" }                                       // tabs + authoring_key + node counts
{ "tool": "get_flow", "arguments": { "flow_id": "abc..." } }   // one tab's full content
{ "tool": "search_nodes", "arguments": { "query": "inject" } } // grep
{ "tool": "render_flow_svg", "arguments": { "tab_id": "abc..." } }
```

Each entry from `list_flows` exposes both `id` (the Node-RED tab ID) and `authoring_key` (the `_authoringKey` extension property if FlowOtter created the tab, else identical to `id`). Author tools' `tab_id` parameter accepts either form — pass whichever you have.

### 3. Plan, then stage

For substantial flows, plan first:

```jsonc
{
  "tool": "plan_flow",
  "arguments": {
    "goal": "Pipe MQTT telemetry through a normalization function into a dashboard",
    "stages": [
      {
        "name": "ingest",
        "purpose": "Receive MQTT messages from the broker",
        "estimated_nodes": 3,
        "organization": "inline",
        "organization_rationale": "Small ingest stage; no need for a group",
      },
      {
        "name": "transform",
        "purpose": "Normalize payloads via JSONata",
        "estimated_nodes": 5,
        "organization": "group",
        "organization_rationale": "Multiple nodes share one logical purpose",
      },
      {
        "name": "display",
        "purpose": "Operator dashboard with gauge + alarm panel",
        "estimated_nodes": 8,
        "organization": "subflow",
        "organization_rationale": "Pattern repeats for two different instruments",
      },
    ],
  },
}
```

Returns `plan_id`, `layout_strategy` (currently `manual`), and ordered `next_actions[]` referencing real tool calls. Writes `plan.json` to staging. There is not yet an MCP `layout_flow` tool; set positions/group geometry explicitly and review with `render_flow_svg`.

Then stage individual nodes:

```jsonc
{
  "tool": "add_node",
  "arguments": {
    "tab_id": "abc...", // Node-RED tab ID OR _authoringKey — both work.
    "type": "debug",
    "opts": { "source_node_id": "inj-123", "label": "Tick Out" },
  },
}
```

Prefer `add_node` (generic) for most authoring — it handles core types AND the long tail of `node-red-contrib-*` packages (Modbus, InfluxDB, OPC UA, etc.). Use `add_<type>_node` specialists from the `author_specialists` toolset only when type-specific schema validation matters.

Response includes `staged_hash`, `based_on_snapshot_hash`, `diff_summary`, `diagnostics` (validator + lint output), and optionally `_guidance: string[]` from the soft-nudge system (e.g., reminds you to call `plan_flow` if you skipped it on a substantial flow). The change lives in `~/.flow-otter/lab/staging/staged.json` and has NOT been deployed.

Preview before committing:

```jsonc
{ "tool": "preview_flow_diff" }   // semantic diff of staged vs runtime
{ "tool": "get_staged_change" }   // staged metadata: staged_hash, agent_id, ownership, staleness
```

`get_staged_change` returns snake_case fields — its `staged_hash` feeds `deploy_staged_change`
directly. It also reports `owned_by_current_session` (false means deploy/discard needs
`force_takeover:true`) and `stale` (true means the staged bytes already match the runtime, so
the next author op will auto-clear the slot). See `CLIENT_CONFIG.md` § Staging ownership.

### 4. Deploy

```jsonc
{
  "tool": "deploy_staged_change",
  "arguments": { "staged_hash": "<from-stage>", "deploy_mode": "nodes" },
}
```

`deploy_mode` options: `nodes` (default, minimal restart), `flows`, `full`, `reload`. The server **elicits user confirmation** via MCP before deploying (Claude Code v2.1.76+). Clients without elicitation support pass `confirm: true` to record consent — **this keeps drift protection fully active**. `force: true` is a separate, stronger flag: it overrides the hash-drift check (deploying on top of concurrent changes) and implies consent — use it only when you intend to overwrite a drifted runtime, never as a routine consent shortcut. The server snapshots the runtime first, retries on rev-mismatch, and recovers from partial-deploy via post-hoc hash verification.

### 5. Observe (the v0.8.0 loop closer)

The first call to `get_recent_debug_messages` lazy-connects to Node-RED's `/comms` WebSocket and starts buffering `topic: 'debug'` frames. Subsequent calls return whatever has accumulated.

```jsonc
{
  "tool": "get_recent_debug_messages",
  "arguments": {
    "node_id": "<the-debug-node-id-from-deploy>", // optional filter
    "limit": 50, // most recent N
    // "flow_id": "abc...",
    // "topic_filter": "sensor",
    // "since_ms": 1715000000000
  },
}
```

Returns `{ ok, connected, buffer_size, dropped_count, last_event_at, messages[] }`. Each message has `{id, z, name, topic, msg, format, timestamp, received_at}`.

### 6. Rollback (if the deploy was wrong)

```jsonc
{ "tool": "rollback_last_change" }
```

Restores the most recent pre-deploy snapshot. The rollback itself takes a snapshot before mutating, so it's reversible too.

### 7. Disconnect

```jsonc
{ "tool": "clear_target" }
```

Disposes the `/comms` WebSocket. Snapshots/staging/audit on disk are preserved — re-pointing at the same `env_name` in a future session picks up the history.

## Multi-target workflows

`set_target` can be called repeatedly to swap between Node-RED instances. Each target has its own `~/.flow-otter/<env_name>/` directory, so a staged change in env A is not visible (or clobberable) from env B.

Recommended for protected runtimes: bridge auth via environment variable rather than the `auth_token` parameter so the token never lands in `target.json`:

```jsonc
{
  "tool": "set_target",
  "arguments": {
    "base_url": "https://nodered.example.com",
    "env_name": "prod",
    "auth_env_var": "PROD_NODE_RED_TOKEN",
  },
}
```

## Templates

`instantiate_template` is the fastest way to lay down a working flow. List options first:

```jsonc
{ "tool": "list_templates" }
```

Then call:

```jsonc
{
  "tool": "instantiate_template",
  "arguments": {
    "template_name": "dashboard_2_skeleton",
    "params": { "title": "Operations", "group_name": "Main" },
  },
}
```

The result is staged like any author op — `deploy_staged_change` to push it.

## Dangerous tier (atomic per-flow surgery)

When `ENABLE_DANGEROUS_TOOLS=true`, three tools surface for direct Admin-API access. They require a confirmation token:

```jsonc
{
  "tool": "prepare_dangerous_operation",
  "arguments": {
    "operation": "update_flow",
    "target": "<flow_id>",
    "flows_hash": "<canonicalHash of the flow body>"
  }
}
// → returns { token: "abcd..." }

{
  "tool": "update_flow",
  "arguments": {
    "flow_id": "<flow_id>",
    "flow": { ... },
    "confirmation_token": "abcd..."
  }
}
```

These bypass staging. The pre-mutation snapshot makes them rollback-able, but they invalidate any concurrently-staged change against the same flow. Use sparingly.

## Limits of automated layout polish

FlowOtter's lints (`on-grid`, `dashboard-2-group-width-fits`, `label-cap`, `tab-divergence`, etc.) catch **measurable violations**. They cannot judge "is this layout good?" — that's human work.

Empirical finding from real use:

- **The first ~3 polish passes** clear real, lint-detectable bugs (label-cap overflow, off-grid coords, group width mismatches, link-resolution issues, duplicate `link in` names). Worth doing.
- **Past Pass 3**, chasing additional zero-warning runs stops tracking what operators care about. Operators use horizontal space liberally, leave groups wider than tight-bounding, accept non-integer y coords from drag events, and treat the editor viewport as freely scrollable in both directions (including negative x).
- **`on-grid` is a style suggestion, not a hard rule** — FlowOtter emits it as `warning`, not `error`. Don't aggressively force-snap coords back to a 20px grid past the first cleanup; the user dragged them where they are on purpose.
- **Render SVG early and ask the user to look** (`render_flow_svg`). Don't trust "0 errors, 0 warnings" as a proxy for visual cleanliness. Lints score JSON, not pixels — a 20px gap between two group bounds can still look like overlap because node bodies extend ~15px below their `y`, and group labels intrude from above.
- **"Lint clean" and "editor clean" are different bars.** Probe the operator's intent before fixing reported overlap: which bar are we aiming for? Different fixes apply.
- **Layout overrides are data, not code.** If you find yourself maintaining a `GROUP_LAYOUT_OVERRIDES` table or 30+ hardcoded position updates inside a generator function, the generator is the wrong shape — extract overrides to a separate file so round-trips through the editor only update data, not code.

## Common failure modes

- **`DriftError` on deploy**: runtime changed since you staged. Preferred: discard the stage (`discard_staged_change`) and re-stage against the new baseline. `confirm:true` does NOT bypass this (consent ≠ drift override); pass `force:true` only to deliberately overwrite the concurrent changes.
- **"A staged change is already pending deploy"**: author tools refuse to stage over an undeployed change (single-slot staging). Deploy it (`deploy_staged_change`) or drop it (`discard_staged_change`), then re-stage. If the pending stage was authored by a different agent session, the refusal names `force_takeover` — pass `force_takeover:true` to `discard_staged_change` to take it over. A pending stage whose bytes already match the runtime is auto-cleared by the next author op (info diagnostic `staging/auto-cleared-stale-stage`); `get_staged_change` shows `stale:true` for those. See `CLIENT_CONFIG.md` § Staging ownership (including `FLOWOTTER_SESSION_ID` for stable session identity across restarts).
- **`Invalid confirmation_token`**: token scope mismatch. Re-request via `prepare_dangerous_operation` with the EXACT same target/hash.
- **`No Node-RED target configured`**: server booted without a target. Call `set_target` first.
- **`connected: false` in `get_recent_debug_messages`**: target is file-source (no admin-api), or initial connect failed. Buffer may still have frames from a prior session.
- **`ValidationFailedError: produced flows with N validation error(s)`**: an author op produced flows.json that violates a lint rule (e.g. duplicate `link in` names, off-canvas, label-cap). The diagnostics list pinpoints the issue.

## Per-plugin gotchas (what FlowOtter doesn't catch)

The toolkit's validators model flow topology, not per-node-module runtime semantics. The following patterns passed FlowOtter validation but failed at Node-RED start or editor load — supply these proactively in `passthrough` (or use the template that does):

- **`ui-gauge` segment ranges.** Segments must be inside the gauge's own `[min, max]`. A default `[from:0, from:70, from:90]` blows up on a gauge with `max:10`. Scale segments to the actual range.
- **`ui-table` v2 `maxrows`.** Required, must be a number. `pageSize` from Dashboard 2.0 v1 is not the same field. Set `maxrows: <int>`.
- **`complete` node `scope`.** Required array of node ids to monitor for completion events. `[]` is invalid — pick at least one target.
- **`inject` node `repeat`.** Required (empty string `""` is OK). Missing key reads as `undefined` → "Invalid repeat value".
- **`link call` node with no static targets.** Set `linkType: "dynamic"` to allow `links: []`; otherwise the validator requires ≥1 valid `link in` peer.
- **`subflow` definitions need `in: []`, `env: []`, `meta: {}`.** Optional in flows.json, but the editor's import loop iterates them and throws `Cannot read properties of undefined (reading 'forEach')` if absent. The `reusable_subflow` template covers this; `create_subflow_definition` calls must populate them explicitly.
- **`mqtt in` / `mqtt out` need a `mqtt-broker` config node.** The typed author tools don't auto-create one. Either use the `inject_to_mqtt` / `mqtt_to_debug` templates (which do), or stage the broker as a config node first and set the `broker` field on each MQTT node.

**FlowOtter group behavior (helpful, not a gotcha):** a group authored without explicit `position`/`size` is auto-sized to a grid-snapped box fitting its member nodes, and receives the Node-RED editor's default visible style — a styleless group renders as an _invisible_ box, so this is applied for you. Supply explicit `position`/`size`/`style` to override.

A worked end-to-end run of all of these (and the prompts that produced them) lives in the [Showcase](../README.md#showcase) section of the top-level README.
