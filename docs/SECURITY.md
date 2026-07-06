# Security

FlowOtter assumes an MCP client can ask powerful questions and request runtime changes. The server therefore defaults to read-only and uses explicit tier gates, snapshot-before-mutate guarantees, drift checks, and substring-level secret scrubbing in audit output.

## Tier Gates

| Tier      | Required config                                                               |
| --------- | ----------------------------------------------------------------------------- |
| Read      | Always available.                                                             |
| Author    | `ENABLE_WRITE_TOOLS=true` and `READ_ONLY_MODE=false`.                         |
| Deploy    | Author requirements plus `ENABLE_DEPLOY_TOOLS=true` and `DRY_RUN_MODE=false`. |
| Dangerous | Deploy requirements plus `ENABLE_DANGEROUS_TOOLS=true`.                       |

The registry hides disabled tools from `tools/list`. v1.3.0 added a second hiding layer — **toolsets** — that progressively-discloses tools by intent (specialists hidden by default until `enable_toolset('author_specialists')`). Both gates must pass for a tool to appear.

## MCP Elicitation Confirmation

v1.3.0 wires MCP elicitation (`server.elicitInput`) into `deploy_staged_change` so destructive operations require explicit user confirmation. Clients that don't advertise the elicitation capability get a `ToolBlockedError` instructing them to pass `force:true` or use a newer client (Claude Code v2.1.76+). Transport failures during elicitation degrade to `cancel`, never silent-accept — so a network glitch can't accidentally deploy.

## Snapshots and Rollback

Every deploy and dangerous operation saves a snapshot before modifying the runtime. Rollback restores a snapshot through the same Admin API flow source and records its own pre-rollback snapshot. Snapshots live under `~/.flow-otter/<env_name>/snapshots/` and are retained per `SNAPSHOT_RETENTION` (default 50).

## Drift Checks

Staged author changes are bound to the runtime hash observed during staging. `deploy_staged_change` reloads runtime flows and refuses deploy if the byte hash changed, unless `force:true` is explicitly supplied.

The deploy path uses the latest runtime rev after the hash check. This allows a harmless rev-only change to deploy while still refusing byte-level drift.

## Dangerous Confirmation

Destructive tools require a token from `prepare_dangerous_operation`. Tokens are scoped to:

- actor
- environment
- operation
- tab id for `delete_tab` / `update_flow` / `delete_flow`
- replacement flow hash for `replace_flows` / `create_flow` / `update_flow`

This prevents a token prepared for one destructive target from being reused for a different target. The token is the leading 32 hex chars of a canonical hash over `{operation, environment, actor, target, flows_hash}`.

## Secrets Redaction

The audit pipeline scrubs secrets at the write boundary in `src/server/audit/redact.ts`. Three guarantees:

1. **Key-level**: any object key matching `token`, `password`, `authorization`, `credential`, `api[_-]?key`, `secret`, or `node_red_auth` has its value replaced with `***REDACTED***` regardless of content.
2. **Value-level (substring)**: any string value containing a Bearer token (`Bearer\s+\S+`), a JWT-shaped string (`segment.segment.segment` with sufficient length), or a 32+ character hex blob has the matching substring replaced with `***REDACTED***`. The substring approach catches embedded secrets in error messages and compound values, e.g. `"request failed: Bearer eyJ…"` is scrubbed even though the value doesn't START with "Bearer".
3. **Allowlist**: the keys `args_hash`, `snapshot_before`, `snapshot_after` are passed through verbatim — these are legitimately hex-shaped and required for audit forensics.

Regression coverage: `tests/unit/server/audit/redact-regression.test.ts`.

## Credentials Beside External Flow Files

Since Node-RED 5.0.0-beta.3 (PR #4951), a credentials file is created alongside an
out-of-`userDir` flows file. If Node-RED is pointed at a flows file outside `userDir`, the sibling
`*_cred.json` now lives next to that file. Treat it as backup and secret-handling scope, and never
commit it. FlowOtter's file-mode credential lookup honors this `credsAlongsideFlows` behavior.

## Multi-target State Isolation

`set_target` re-scopes all per-target state under `~/.flow-otter/<env_name>/`. Snapshots, staging directory, audit log file, and persisted `target.json` are isolated per `env_name`. Switching between targets via `set_target` / `clear_target` swaps the active state directory; the previous target's state remains on disk untouched, so accidentally pointing at a sibling project does not corrupt its history. Auth tokens are never persisted; the `auth_env_var` reference mechanism is the recommended way to bridge a token from process env to a persisted target.

## `get_recent_debug_messages` Buffer Leakage

The `/comms` WebSocket buffer holds the most recent N debug messages (default 500, env-overridable via `DEBUG_BUFFER_SIZE`). Anything a debug node emits — including operator-secret payloads carried in `msg.payload` — lands in the buffer in plaintext and is readable by any client with read-tier access.

Mitigations:

- Treat the debug buffer as in-memory only; it does not persist across process restarts.
- The buffer is per-target. Calling `clear_target` disposes the WebSocket and drops the buffer.
- For sensitive flows, **disable debug nodes in production** (the `active: false` flag in the node config).
- For protected-runtime setups, ensure the MCP client is trusted at the same level as Node-RED's editor — both can see debug output via the same WebSocket.

## Per-flow CRUD (`create_flow` / `update_flow` / `delete_flow`)

These dangerous-tier tools bypass the staging pipeline. They are the right primitive for atomic surgery on a single tab when a full-flows POST would be wasteful, but:

- They invalidate any concurrently-staged change whose `basedOnSnapshotHash` references the modified flow.
- They do not run validation or linting on the supplied flow body — the caller is trusted to produce a valid Node-RED tab.
- Pre-mutation runtime snapshots are recorded so rollback works.

Recommendation: don't mix `update_flow` / `delete_flow` with staged author tools in the same session. If an agent must use both, call `get_staged_change` first to verify nothing is pending.

## `set_links` / `set_wires` Validation Invariants

Both tools validate before staging:

- `set_links`: source must be `link out` or `link call`; every target must be `link in`; targets must already exist in the prior compiled flows (so Node-RED IDs are knowable).
- `set_wires`: source node + output port must exist; output port must be within the source's `getOutputPortCount`; every target must live on the SAME tab as the source (cross-tab via link nodes); self-wire is refused; targets are deduplicated.

The compile pipeline still runs after the op, and lint rules (`link-resolution`, `wire-targets`, `id-uniqueness`, etc.) reject any compiled output with broken topology before the change reaches the staging directory.

## Node Engine Requirement

`engines.node = ">=20.0.0"`. Node 20 LTS is the supported floor; Node 22+ also works and is the recommended target for new installs.

## Recommended Runtime Setup

- Run Node-RED behind local network controls or authentication.
- Use the smallest needed tier flags for each MCP client session.
- Keep `ENABLE_DANGEROUS_TOOLS=false` for normal authoring.
- Store snapshots and audit logs on durable local storage.
- Use separate `ENVIRONMENT_NAME`, `SNAPSHOT_DIR`, `STAGING_DIR`, and `AUDIT_LOG_PATH` values for each Node-RED target so rollback history and staged changes cannot be confused between projects.
- Review `get_staged_change` and `preview_flow_diff` before deployment in production environments.
- For protected-runtime targets, prefer the `auth_env_var` reference in `target.json` over passing tokens to `set_target` directly — the token value never lands on disk.
