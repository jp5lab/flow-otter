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
