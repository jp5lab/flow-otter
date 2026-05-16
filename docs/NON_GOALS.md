# Non-Goals

FlowOtter ships v1.0 as a sealed release. The items below are explicitly **out of scope** for v1.0 and are not planned for any subsequent version. They appear here so future work can prove "is this a v1 problem?" against a documented list, not against the original `~/.claude/plans/you-will-work-from-enchanted-pine.md` which lives outside the repo.

## Auth + connectivity

- **OAuth / PKCE auth strategy.** FlowFuse-hosted Node-RED targets that use OAuth are not supported. The shipped auth strategies (`BearerAuth`, `PasswordGrantAuth`, `NoAuth`) cover the static-token, password-grant, and unauthenticated paths.
- **Streaming MCP push tools.** All toolkit interactions are request/response. Agents poll `get_recent_debug_messages` for new debug frames rather than subscribing to a push stream.

## WebSocket / `/comms` scope

- **Topics other than `debug`.** The comms client subscribes to `topic === 'debug'` only. `status/*`, `notification/runtime-state`, `notification/runtime-deploy`, and other Node-RED comms events are parsed but discarded.
- **Persistent debug message buffer.** The ring buffer is in-memory only. Buffer contents do not survive process restart or WebSocket reconnect.
- **Server-side filtering at the WebSocket layer.** All filtering (`node_id`, `flow_id`, `topic_filter`, `since_ms`, `limit`) is applied client-side over the buffer snapshot.

## Validation / layout

- **Function-node JS-IR.** Function bodies are stored as opaque strings. `acorn` validates syntax only; semantic analysis is out of scope.
- **ELK layout algorithm.** `dagre` remains the only layout algorithm.
- **Visual-regression CI on rendered SVG/PNG.** SVG snapshot tests cover deterministic rendering, but no pixel-diff CI step exists.

## Cross-environment

- **Cross-environment snapshot promotion.** Snapshots stay in `~/.flow-otter/<env_name>/snapshots/`. There is no tool to promote a snapshot from `dev` to `prod`.
- **Multi-language SDKs.** TypeScript / JavaScript only.

## Distribution

- **npm publish to public registry.** The package stays private. Distribution is git-clone-and-build.
- **Public Docker registry push.** `docker build -f deploy/Dockerfile .` succeeds locally; no image is pushed to ghcr.io / Docker Hub.
- **GitHub Actions / hosted CI.** v1 readiness is verified by `scripts/v1-readiness-check.sh` and a captured evidence file under `evidence/`. No continuous regression catching beyond what `npm test` provides.
- **Real-runtime validation against lab VMs or FlowFuse Cloud.** The Docker test stack at `deploy/docker-compose.yml` is the only runtime substrate exercised in v1.

## Server-side surface

- **Web UI for snapshots / audit log.** Both are filesystem-only artefacts inspected via `get_snapshot` / `get_audit_log_recent` MCP tools.

---

This list is final. If a need arises that intersects with one of these items, it will not reopen the v1 scope — it becomes the trigger for evaluating whether a v2 is warranted.
