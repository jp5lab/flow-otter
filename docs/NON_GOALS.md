# Non-Goals

The items below are explicitly **out of scope** for the FlowOtter v1.x line. They appear here so contributors and integrators can quickly answer "is this a thing FlowOtter does?" against a documented list.

## Auth + connectivity

- **OAuth / PKCE auth strategy.** FlowFuse-hosted Node-RED targets that use OAuth are not supported. The shipped auth strategies (`BearerAuth`, `PasswordGrantAuth`, `NoAuth`) cover the static-token, password-grant, and unauthenticated paths.
- **Streaming MCP push tools.** All toolkit interactions are request/response. Agents poll `get_recent_debug_messages` for new debug frames rather than subscribing to a push stream.

## WebSocket / `/comms` scope

- **Topics other than `debug`.** The comms client subscribes to `topic === 'debug'` only. `status/*`, `notification/runtime-state`, `notification/runtime-deploy`, and other Node-RED comms events are parsed but discarded.
- **Persistent debug message buffer.** The ring buffer is in-memory only. Buffer contents do not survive process restart or WebSocket reconnect.
- **Server-side filtering at the WebSocket layer.** All filtering (`node_id`, `flow_id`, `topic_filter`, `since_ms`, `limit`) is applied client-side over the buffer snapshot.

## Validation / layout

- **Function-node JS-IR.** Function bodies are stored as opaque strings. `acorn` validates syntax only; semantic analysis is out of scope.
- **Visual-regression CI on rendered SVG/PNG.** SVG snapshot tests cover deterministic rendering, but no pixel-diff CI step exists.

## Cross-environment

- **Cross-environment snapshot promotion.** Snapshots stay in `~/.flow-otter/<env_name>/snapshots/`. There is no tool to promote a snapshot from `dev` to `prod`.
- **Multi-language SDKs.** TypeScript / JavaScript only.

## Distribution

- **Public Docker registry push.** `docker build -f deploy/Dockerfile .` succeeds locally; no image is pushed to ghcr.io / Docker Hub.
- **GitHub Actions / hosted CI.** Local verification (`npm run typecheck && npm run lint && npm run format:check && npm run test:unit && npm run test:property && npm run build`) is the contract — no CI workflows ship in the repo.
- **Real-runtime validation against lab VMs or FlowFuse Cloud.** The Docker test stack at `deploy/docker-compose.yml` is the only runtime substrate exercised in CI-style verification.

## Server-side surface

- **Web UI for snapshots / audit log.** Both are filesystem-only artefacts inspected via `get_snapshot` / `get_audit_log_recent` MCP tools.
- **Credential authoring.** FlowOtter does not author Node-RED credentials — flows deploy with empty credential fields and the user fills them in via the Node-RED editor. The `credential-leak` validator catches secrets stuffed into wrong fields. See decision rationale in `docs/DESIGN.md`.

---

If a contribution intersects with an item on this list, open an issue first to discuss the trade-off — the line isn't immutable, but each item here had a reason at the time it was drawn.
