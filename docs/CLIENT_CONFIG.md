# Client Configuration

FlowOtter is a reusable MCP server for agents that need to inspect, validate, author, stage,
deploy, and roll back Node-RED flows. It is not tied to one lab, instrument, dashboard, or
project. The selected Node-RED runtime is set at startup or chosen by the agent at runtime via
the `set_target` tool.

## Target Model

- `NODE_RED_BASE_URL` selects the Node-RED Admin API target when `FLOW_SOURCE=admin-api`.
- `FLOW_SOURCE=file` points tools at a local `flows.json` for offline analysis or tests.
- The `set_target` tool flips the active target at runtime, switching to `FLOW_SOURCE=admin-api`
  with the supplied URL and optional auth. It re-scopes `SNAPSHOT_DIR`, `STAGING_DIR`, and
  `AUDIT_LOG_PATH` under `~/.flow-otter/<env_name>/` so state from different targets does not
  cross-contaminate.
- `ENVIRONMENT_NAME` labels snapshots, rollback history, dangerous-operation tokens, and audit
  events. `set_target` derives this from the URL host (`<host>_<port>`, sanitised) unless the
  caller supplies `env_name` explicitly.

The flows returned by tools such as `list_flows`, `get_flow`, and `validate_all_flows` are the
flows from the active target. If an agent sees unexpected tabs, run `health_check` or
`get_server_config_summary` to confirm where the server is pointed.

## Single-Entry Setup (Recommended)

Register one entry, let the agent pick the URL via `set_target`:

```json
{
  "mcpServers": {
    "FlowOtter": {
      "command": "node",
      "args": ["/absolute/path/to/FlowOtter/dist/bin/flow-otter.js"],
      "env": {
        "FLOW_SOURCE": "file",
        "READ_ONLY_MODE": "true",
        "ENVIRONMENT_NAME": "default"
      }
    }
  }
}
```

The server boots without a Node-RED target. The agent calls `set_target` when it needs to talk
to a live runtime.

## Multi-Project Setup (Pre-Bound Targets)

If you prefer pre-pinned targets and don't want the agent picking URLs:

```json
{
  "mcpServers": {
    "FlowOtter-local": {
      "command": "node",
      "args": ["/absolute/path/to/FlowOtter/dist/bin/flow-otter.js"],
      "env": {
        "FLOW_SOURCE": "admin-api",
        "NODE_RED_BASE_URL": "http://localhost:1880",
        "ENVIRONMENT_NAME": "local-dev",
        "SNAPSHOT_DIR": "~/.flow-otter/local-dev/snapshots",
        "STAGING_DIR": "~/.flow-otter/local-dev/staging",
        "AUDIT_LOG_PATH": "~/.flow-otter/local-dev/audit.jsonl",
        "READ_ONLY_MODE": "true"
      }
    },
    "FlowOtter-lab": {
      "command": "node",
      "args": ["/absolute/path/to/FlowOtter/dist/bin/flow-otter.js"],
      "env": {
        "FLOW_SOURCE": "admin-api",
        "NODE_RED_BASE_URL": "http://192.168.1.10:1880",
        "ENVIRONMENT_NAME": "lab",
        "SNAPSHOT_DIR": "~/.flow-otter/lab/snapshots",
        "STAGING_DIR": "~/.flow-otter/lab/staging",
        "AUDIT_LOG_PATH": "~/.flow-otter/lab/audit.jsonl",
        "ENABLE_WRITE_TOOLS": "true",
        "ENABLE_DEPLOY_TOOLS": "true",
        "READ_ONLY_MODE": "false"
      }
    }
  }
}
```

MCP clients differ in whether they expand `~` in environment values. Use absolute paths if the
client passes environment variables through literally.

## Recommended Agent Workflow

Start read-only for discovery (no preset target):

```bash
FLOW_SOURCE=file READ_ONLY_MODE=true node dist/bin/flow-otter.js
```

Then have the agent call `set_target` to point at a live runtime when needed:

```jsonc
// agent invokes set_target
{ "base_url": "http://localhost:1880", "env_name": "local-dev" }
```

Enable author tools only for controlled editing sessions:

```bash
FLOW_SOURCE=file \
ENABLE_WRITE_TOOLS=true \
READ_ONLY_MODE=false \
node dist/bin/flow-otter.js
```

Enable deploy tools only when the agent is expected to push staged changes to the runtime:

```bash
FLOW_SOURCE=file \
ENABLE_WRITE_TOOLS=true \
ENABLE_DEPLOY_TOOLS=true \
READ_ONLY_MODE=false \
node dist/bin/flow-otter.js
```

Keep dangerous tools disabled for normal agent sessions.

## Staging ownership (`FLOWOTTER_SESSION_ID`)

Staging is **single-slot per environment**: each `~/.flow-otter/<env_name>/staging/` directory
holds at most one pending change. Every staged change is tagged with the session id of the agent
process that staged it (`staged.agent_id`).

- **Session identity.** At boot, each FlowOtter process derives a stable session id from the
  `FLOWOTTER_SESSION_ID` environment variable; when unset it falls back to `pid-<process id>`.
  The pid fallback changes on every restart, which makes a restarted client a "different agent"
  to its own leftover stage. Set `FLOWOTTER_SESSION_ID` to a stable value in the MCP
  registration `env` block when you want staging ownership to survive client restarts:

  ```json
  "env": {
    "FLOWOTTER_SESSION_ID": "claude-desktop-main"
  }
  ```

- **Ownership enforcement.** `deploy_staged_change` and `discard_staged_change` refuse to act on
  a stage whose `agent_id` differs from the current session, unless `force_takeover:true` is
  passed. Author tools refuse to stage over any pending change (deploy it or discard it first);
  when the pending stage belongs to a different session, the refusal message names
  `force_takeover` so the recovery path (`discard_staged_change` with `force_takeover:true`) is
  explicit. Stages written before v0.6.0 carry no `agent_id` and are treated as owned by
  everyone (back-compat).

- **Stale-stage auto-clear.** A pending stage whose `staged_hash` is byte-identical to the
  current runtime flows carries no undeployed work, so the next author op auto-clears it —
  regardless of which session staged it (byte-equality makes clearing information-lossless) —
  and proceeds, surfacing an info diagnostic `staging/auto-cleared-stale-stage`. A pending stage
  whose hash differs from the runtime always blocks; it is never auto-cleared.

- **Inspecting ownership.** `get_staged_change` reports `agent_id`, `owned_by_current_session`
  (false means deploy/discard needs `force_takeover:true`), and `stale` (true means the next
  author op will auto-clear it; null when the runtime is unreachable).

## Node-RED Version Notes

Node-RED 5.0.0-beta.6+ removed the default `httpAdminCors` rules (PR #5652). Browser-based
cross-origin Admin API clients must configure CORS explicitly in `settings.js`. FlowOtter
surfaces this as the `adminCorsDefault` capability in `health_check`: `true` means the target is
older than 5.0.0-beta.6 and still has the default rules.

The `/flows/state` runtime-state API exists in supported Node-RED 2.x+ runtimes, but it also
requires `runtimeState.enabled = true` in `settings.js`. `health_check.runtime.capabilities`
reports version eligibility; it does not prove the setting is enabled.

## Troubleshooting

- Run `health_check` first. It reports the configured target and whether `/flows` is reachable.
- Run `get_server_config_summary` to confirm the effective target, flow source, tier flags, and
  local state paths without exposing secrets.
- If `health_check` shows `<unset>` for the target, call `set_target` to pick one.
- If staged changes or rollbacks seem to reference the wrong project, confirm `ENVIRONMENT_NAME`
  via `get_server_config_summary`. Each `set_target` call re-scopes state under a new env_name
  unless overridden.
- If standalone shell tests cannot reach `localhost` but the MCP client can, check local sandbox
  or permission boundaries before changing MCP code.
