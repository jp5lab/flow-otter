# Architecture

FlowOtter has two layers. The server is project-agnostic: it exposes generic Node-RED
inspection, validation, authoring, staging, deployment, and rollback tools. Project-specific
behavior comes from the configured flow source, not from hardcoded logic in the MCP server.

## Layer 1: Toolkit

`src/toolkit/**` is pure TypeScript. It has no Node-RED runtime dependency and does not read clocks or random sources. The key contracts are:

- `authoring/compile.ts`: converts `AuthoringSpec` to deterministic `flows.json`.
- `authoring/decompile.ts`: recovers an `AuthoringSpec` from existing flows, preserving `_authoringKey` identity.
- `validate/**` and `lint/**`: structural checks for wire targets, groups, links, subflows, dashboard hierarchy, naming contracts, function syntax, secret patterns, and ISA-101 operator-screen rules (`unbounded-chart-append`, `screen-clutter`, `saturated-color-outside-alarm`, `button-group-color-decoration`, `dashboard-2-destructive-needs-confirm`).
- `diff/**`: semantic flow diffs for staged previews and audit summaries.
- `snapshot/**` and `staging/**`: filesystem-backed snapshots, one pending staged change, plus the v1.3.0 `plan-record.ts` (records `plan_flow` output for soft-nudge consumption).
- `layout/**` and `render/**`: deterministic internal layout helpers and SVG previews. `layout/index.ts` can dispatch to dagre/elkjs, but no MCP `layout_flow` tool is exposed yet; the supported agent workflow is explicit node/group positioning followed by `render_flow_svg` review.
- `templates/**`: built-in template catalog (27 templates across `generic`/`dashboard`/`operator`/`pipeline` categories).
- `catalog/**` (v1.3.0): the structured capability catalog returned by `get_authoring_guide` — Node-RED concepts, core node types, Dashboard 2.0 widgets, validators, ISA-101 design principles, methodology.

Idempotency is enforced by property tests. A given `AuthoringSpec` must compile to byte-identical JSON across runs. Internal layout helpers are deterministic — ELK uses a pinned `randomSeed: 1` and `considerModelOrder: NODES_AND_EDGES` — but layout quality still requires visual review.

## Layer 2: MCP Server

`src/server/**` wraps the toolkit with IO, config, audit, and MCP transport:

- `container.ts` wires config, flow source, snapshots, staging, audit, logging, clock, optional Node-RED REST client (`NodeRedClient`), optional `/comms` WebSocket client (`NodeRedCommsClient`), the MCP Server instance (`mcpServer`), the tool registry (`toolRegistry`), and lazy-probed Node-RED runtime info (`runtimeInfo`).
- `tools/**` exposes explicit MCP tools. `ALL_TOOLS` in `src/server/index.ts` is intentionally a flat import list; the **toolset registry** (`tools/toolsets.ts` + `tools/register.ts`) groups them into 9 named sets (`core`, `discovery`, `analyze`, `snapshots`, `audit`, `author`, `author_specialists`, `deploy`, `dangerous`) and filters `tools/list` output by which sets are enabled.
- `config/tiers.ts` hides author, deploy, and dangerous tools unless the relevant environment flags are enabled. Tiers and toolsets are independent gates — both must pass for a tool to appear.
- `transport/stdio.ts` exposes the MCP stdio server. Declares both `tools` and `prompts` capabilities; registers `ListPromptsRequestSchema` + `GetPromptRequestSchema` handlers backed by `prompts/registry.ts`. Sets the `instructions` field on the MCP Server with the methodology playbook (`SERVER_INSTRUCTIONS` in `index.ts`).
- `nudges/**` (v1.3.0): the response-side guidance system. `_tool.ts:makeInvokable` wraps every tool invocation, builds a `NudgeContext` from staging + plan + flow state, evaluates applicable nudges, and appends `_guidance: string[]` to object outputs when relevant.
- `elicitation/client.ts` (v1.3.0): typed wrapper around the MCP SDK's `elicitInput`. `deploy_staged_change` uses it to gate destructive operations behind explicit user confirmation; degrades to `unsupported` when the client doesn't advertise elicitation.
- `runtime-info.ts` (v1.3.0): lazy-probes Node-RED `/settings` for the connected runtime's version and computes a capability matrix (`groupNesting`, `junctions`, `functionLinkCall`, `adminCorsDefault`, etc.) so version-gated features can be advertised on `health_check`.
- `prompts/registry.ts` (v1.3.0): 5 user-facing MCP prompts surfaced as `/mcp__flow-otter__<name>` slash commands.

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
9. Return staged hash, diagnostics, diff, and previews — plus `_guidance` from the nudge system when applicable.

Deploy tools then **elicit user confirmation** (unless `force:true`), snapshot current runtime, verify drift by hash, save via the Admin API, clear staging, and audit the operation. The pre-deploy `preview_flow_diff` call is tracked per-session so `deploy_staged_change` can nudge agents who skipped it.

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

---

# Parallel sessions & multi-target process model

_(Previously `docs/PARALLEL-SESSIONS.md`.)_

## Running FlowOtter across many parallel agent sessions

FlowOtter is a per-session stdio subprocess: every Claude Code (or other MCP client) session that talks to FlowOtter spawns its own `node dist/bin/flow-otter.js` process. Two sessions = two independent processes with independent in-memory state. The shared boundary is the on-disk state under `~/.flow-otter/<env_name>/`.

This doc covers the three shapes of "many sessions, many targets" you're likely to want — e.g. one agent authoring smart-home flows on a home Node-RED, another driving a manufacturing-cell dashboard on a factory Node-RED, both at the same time.

### The persistence model

Every successful `set_target` call writes `~/.flow-otter/<env_name>/target.json`. On the next process boot for the same `ENVIRONMENT_NAME`, the server rehydrates that target automatically — you don't have to call `set_target` again after each restart.

What's persisted:

```json
{
  "schema_version": 1,
  "env_name": "factory-line-a",
  "flow_source": "admin-api",
  "base_url": "http://192.168.1.10:1880",
  "set_at": "2026-05-10T13:35:42.000Z"
}
```

What's **not** persisted:

- Auth tokens, passwords, basic-auth credentials. Never. If your target requires auth, supply it via env var on the MCP registration (`NODE_RED_AUTH_TOKEN`) or re-call `set_target` with credentials each session.
- Override directories (`snapshot_dir`, `staging_dir`, `audit_log_path`). Rehydration uses the canonical `~/.flow-otter/<env_name>/{snapshots,staging,audit.jsonl}` paths.

Boot resolution order:

1. Explicit env vars on the registration (`NODE_RED_BASE_URL` or `FLOW_FILE_PATH`) — wins, no rehydrate.
2. Persisted `~/.flow-otter/<ENVIRONMENT_NAME>/target.json` — rehydrate.
3. Default file source (`./flows.json` relative to the spawned process cwd).

`health_check` reports `env_name`, `persisted_target_path`, and `persisted_target_age_seconds` so you can verify rehydration worked.

### Shape A: one global registration, target chosen per session via `set_target`

The simplest setup. One `FlowOtter` entry in `~/.claude.json`, every session calls `set_target` once with its own `env_name`. Persistence makes it sticky after that.

```json
"FlowOtter": {
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/FlowOtter/dist/bin/flow-otter.js"],
  "env": {
    "ENABLE_WRITE_TOOLS": "true",
    "READ_ONLY_MODE": "false"
  }
}
```

Session A:

```
set_target { base_url: "http://192.168.1.10:1880", env_name: "factory-line-a" }
```

Session B (different terminal, different agent):

```
set_target { base_url: "http://192.168.1.20:1880", env_name: "home-automation" }
```

After both have set their targets once, every subsequent restart rehydrates the right target per session **as long as each session boots with its own distinct `ENVIRONMENT_NAME`**. The catch: with one global registration, every spawned process boots with the same default `ENVIRONMENT_NAME` (whatever's in the registration env). Distinct `env_name` in `set_target` is enough to keep state directories isolated, but the **first** boot of a given process won't know which env to rehydrate. If you want fully zero-touch boot per session, use Shape B or C.

**Use this when**: the agent is willing to call `set_target` once per session.

### Shape B: per-project `.mcp.json`

Claude Code reads project-scoped MCP servers from `.mcp.json` in the project directory. Each project pins its own `ENVIRONMENT_NAME`, so when you `cd` into that project and start Claude Code, FlowOtter boots already scoped to the right env — and rehydration finds the right `target.json` automatically.

`/path/to/my-project/.mcp.json`:

```json
{
  "mcpServers": {
    "FlowOtter": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/FlowOtter/dist/bin/flow-otter.js"],
      "env": {
        "ENVIRONMENT_NAME": "my-project",
        "ENABLE_WRITE_TOOLS": "true",
        "READ_ONLY_MODE": "false"
      }
    }
  }
}
```

Each project gets its own `.mcp.json` with its own `ENVIRONMENT_NAME`. First time you use a project, call `set_target` once; from then on, the target is sticky across restarts.

**Use this when**: each project has a stable, long-lived target and you want zero-touch boot.

### Shape C: bake the target into the registration

If you want maximum determinism — no rehydration, no `set_target` ever needed — pin the target at registration time. Per-target registration entries:

```json
"FlowOtter-factory": {
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/FlowOtter/dist/bin/flow-otter.js"],
  "env": {
    "NODE_RED_BASE_URL": "http://192.168.1.10:1880",
    "FLOW_SOURCE": "admin-api",
    "ENVIRONMENT_NAME": "factory-line-a",
    "ENABLE_WRITE_TOOLS": "true",
    "READ_ONLY_MODE": "false"
  }
},
"FlowOtter-home": {
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/FlowOtter/dist/bin/flow-otter.js"],
  "env": {
    "NODE_RED_BASE_URL": "http://192.168.1.20:1880",
    "FLOW_SOURCE": "admin-api",
    "ENVIRONMENT_NAME": "home-automation",
    "ENABLE_WRITE_TOOLS": "true",
    "READ_ONLY_MODE": "false"
  }
}
```

Explicit `NODE_RED_BASE_URL` suppresses persisted-target rehydration — the registration is the source of truth and `set_target` swaps work in-process for the session but won't outlive the registration's pin on next restart.

**Use this when**: targets are very stable (managed fleet, production), and you want the registration itself to be the manifest of "what targets exist."

### Concurrency notes

Each session is a separate process, so memory state is naturally isolated. The collision risk is shared `env_name` — two parallel sessions both writing into `~/.flow-otter/foo/staging/` or appending to the same `audit.jsonl`. Practically:

- **Distinct `env_name` per parallel session is required** if both want to author. The audit log is append-only and survives concurrent writers, but the staging directory's last-write-wins semantics will surprise you.
- **Same `env_name` for read-only parallel sessions is fine.** Two agents both reading the same target via `get_flow` / `analyze_flow` have no shared mutable state.
- **`set_target` does not lock.** If session A and session B both write `target.json` for the same `env_name` concurrently, the last write wins. The discriminated-union schema makes corruption impossible (atomic temp-file rename), but you may see flapping if two agents are fighting over the same env.

### Auth limitation

The persistence layer never writes auth tokens to disk. For protected Node-RED runtimes:

- **Easiest**: put `NODE_RED_AUTH_TOKEN` in the MCP registration env. Persistence + rehydration carries the URL and env-name; auth comes from env at every boot.
- **Per-session**: pass `auth_token` into `set_target` each session.
- **Env-var-ref scheme**: pass `auth_env_var: "NODE_RED_TOKEN_<env>"` into `set_target` — the variable NAME is persisted to `target.json` but the token VALUE is never written. The rehydrator reads the env var at boot and bridges the token in. Available since v0.5.0.
