# Running FlowOtter across many parallel agent sessions

FlowOtter is a per-session stdio subprocess: every Claude Code (or other MCP client) session that talks to FlowOtter spawns its own `node dist/bin/flow-otter.js` process. Two sessions = two independent processes with independent in-memory state. The shared boundary is the on-disk state under `~/.flow-otter/<env_name>/`.

This doc covers the three shapes of "many sessions, many targets" you're likely to want — e.g. one agent authoring smart-home flows on a home Node-RED, another driving a manufacturing-cell dashboard on a factory Node-RED, both at the same time.

## The persistence model

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

## Shape A: one global registration, target chosen per session via `set_target`

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

## Shape B: per-project `.mcp.json`

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

## Shape C: bake the target into the registration

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

## Concurrency notes

Each session is a separate process, so memory state is naturally isolated. The collision risk is shared `env_name` — two parallel sessions both writing into `~/.flow-otter/foo/staging/` or appending to the same `audit.jsonl`. Practically:

- **Distinct `env_name` per parallel session is required** if both want to author. The audit log is append-only and survives concurrent writers, but the staging directory's last-write-wins semantics will surprise you.
- **Same `env_name` for read-only parallel sessions is fine.** Two agents both reading the same target via `get_flow` / `analyze_flow` have no shared mutable state.
- **`set_target` does not lock.** If session A and session B both write `target.json` for the same `env_name` concurrently, the last write wins. The discriminated-union schema makes corruption impossible (atomic temp-file rename), but you may see flapping if two agents are fighting over the same env.

## Auth limitation

The persistence layer never writes auth tokens to disk. For protected Node-RED runtimes:

- **Easiest**: put `NODE_RED_AUTH_TOKEN` in the MCP registration env. Persistence + rehydration carries the URL and env-name; auth comes from env at every boot.
- **Per-session**: pass `auth_token` into `set_target` each session.
- **Env-var-ref scheme** (planned): `target.json` stores `auth_env_var: "NODE_RED_TOKEN_<env>"` and the rehydrator reads that env var at boot. Additive when shipped.
