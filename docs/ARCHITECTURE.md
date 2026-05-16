# Architecture

FlowOtter has two layers. The server is project-agnostic: it exposes generic Node-RED
inspection, validation, authoring, staging, deployment, and rollback tools. Project-specific
behavior comes from the configured flow source, not from hardcoded logic in the MCP server.

## Layer 1: Toolkit

`src/toolkit/**` is pure TypeScript. It has no Node-RED runtime dependency and does not read clocks or random sources. The key contracts are:

- `authoring/compile.ts`: converts `AuthoringSpec` to deterministic `flows.json`.
- `authoring/decompile.ts`: recovers an `AuthoringSpec` from existing flows, preserving `_authoringKey` identity.
- `validate/**` and `lint/**`: structural checks for wire targets, groups, links, subflows, dashboard hierarchy, naming contracts, function syntax, and secret patterns.
- `diff/**`: semantic flow diffs for staged previews and audit summaries.
- `snapshot/**` and `staging/**`: filesystem-backed snapshots and one pending staged change.
- `layout/**` and `render/**`: deterministic layout and SVG previews.
- `templates/**`: built-in template catalog.

Idempotency is enforced by property tests. A given `AuthoringSpec` must compile to byte-identical JSON across runs.

## Layer 2: MCP Server

`src/server/**` wraps the toolkit with IO, config, audit, and MCP transport:

- `container.ts` wires config, flow source, snapshots, staging, audit, logging, clock, optional Node-RED REST client (`NodeRedClient`), and optional `/comms` WebSocket client (`NodeRedCommsClient`).
- `tools/**` exposes explicit MCP tools. `ALL_TOOLS` in `src/server/index.ts` is intentionally a flat import list.
- `config/tiers.ts` hides author, deploy, and dangerous tools unless the relevant environment flags are enabled.
- `transport/stdio.ts` exposes the MCP stdio server used by desktop and CLI clients.

Flow IO is abstracted by `FlowSource`:

- `AdminApiFlowSource` calls Node-RED Admin API `/flows`.
- `FileFlowSource` reads/writes a local `flows.json`, used heavily by unit tests.

Debug observation uses a separate adapter:

- `NodeRedCommsClient` (`src/adapters/nodered/comms.ts`) connects to Node-RED's `/comms` WebSocket on first call to `get_recent_debug_messages`, subscribes to `topic: 'debug'` only, and maintains a bounded ring buffer per target. Handles both Authorization-header and post-open frame-based auth handshakes. Lazy connect; reconnect with bounded backoff (1s → 30s, capped at 5 attempts). Disposed on `clear_target` / `set_target` swap / server shutdown.

For `AdminApiFlowSource`, `NODE_RED_BASE_URL` selects the runtime at startup. The agent can
also call `set_target` at runtime to switch the active target; that re-scopes
`SNAPSHOT_DIR`, `STAGING_DIR`, and `AUDIT_LOG_PATH` under `~/.flow-otter/<env_name>/` so state from
different targets doesn't cross-contaminate. For multi-project use without `set_target`, clients
can still register one MCP server entry per target with explicit per-target paths.

## Write Pipeline

Author tools follow the same explicit sequence:

1. Load current runtime flows.
2. Decompile to `AuthoringSpec`.
3. Apply one operation or template.
4. Compile with prior flows so existing IDs are preserved.
5. Validate and lint.
6. Diff prior vs next.
7. Render before/after SVG.
8. Write the staged change.
9. Return staged hash, diagnostics, diff, and previews.

Deploy tools then snapshot current runtime, verify drift by hash, save via the Admin API, clear staging, and audit the operation.

## Dangerous Pipeline

Dangerous tools are gated twice:

1. Registry tier gate: hidden unless write, deploy, and dangerous flags are enabled and read-only/dry-run are off.
2. Confirmation token: `prepare_dangerous_operation` issues a token scoped to actor, environment, operation, and target/hash. Destructive tools reject mismatched tokens.

Dangerous operations snapshot before saving, so `rollback_last_change` can restore the previous runtime state.

## What is intentionally not exposed

Some Node-RED capabilities live in-process and have no Admin API surface — FlowOtter intentionally does not pretend to expose them.

- **Runtime + install hooks**: `RED.hooks.add('onAdd', ...)`, `onStart`, `onStop`, `onPreInstall`, `onPostInstall`. These run inside the Node-RED process; an external MCP cannot subscribe. If your tool needs hook-driven behaviour, ship it as a Node-RED contrib module that registers the hook in-process and (optionally) emits MQTT/HTTP events FlowOtter can poll.
- **Context storage** (global / flow / node context): the Admin API does not expose `RED.util.getMessageProperty` or context backends to external clients. Reads happen via debug tools, dashboards, or contrib endpoints.
- **Editor websocket events** other than `debug`: `/comms` carries deploy, status, and notification events for the editor UI. FlowOtter subscribes ONLY to `topic: 'debug'` (see `NodeRedCommsClient`). The `status/*`, `notification/runtime-state`, and `notification/runtime-deploy` topics are parsed and discarded — equivalent state is available via polling endpoints (`get_runtime_state`, `health_check`).

When something looks like it should be in the API but isn't, default to the assumption above before adding a new tool.
