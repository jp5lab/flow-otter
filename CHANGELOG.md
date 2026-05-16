# Changelog

## 1.1.0 - 2026-05-16 — Roundtrip fidelity + config-knob enforcement + tool-ID symmetry

Correctness pass: the v0.3.0 schema additions (junction, tab `locked`/`env`, group `g`/`info`/x/y/w/h, comment w/h) were declared in `flows-json.ts` but never propagated through the decompile→compile pipeline, so any author tool re-staging a flow silently dropped them. This release closes that gap, wires the dead config knobs to their documented behavior, and resolves the asymmetry between Node-RED IDs in `list_flows` output and authoring keys in author-tool inputs.

### Fixed — lossy decompile/compile roundtrip

- **Junction nodes**: previously dropped entirely on roundtrip. The decompile loop now collects them into `TabSpec.junctions` / `SubflowDefSpec.junctions`; the compile emitter walks them and rebuilds wires through the shared connection model.
- **Tab `locked` (3.1+) and `env`**: previously dropped because `emitTab` only wrote label/disabled/info. Now typed on `TabSpec.locked` + `TabSpec.env: TabEnvEntry[]` and round-tripped.
- **Group `x`/`y`/`w`/`h`/`g` (parent)/`info`**: previously either dropped (x/y/w/h) or misshaped into the `style` field (g/info). Typed explicitly on `GroupSpec.position` / `size` / `parentKey` / `info` and emitted as top-level Node-RED fields.
- **Comment `w`/`h`**: previously dropped. Now on `CommentSpec.size` and round-tripped.
- **Tab unknown fields**: `TabSpec.passthrough` catch-all added for forward-compatibility with future Node-RED tab-level fields.
- **`wire-targets` validator**: previously only checked regular-node wires. Now also checks junction outgoing wires.
- **`analyze` structural counters and orphan-detection**: now include junctions for wire-counting and don't false-flag wired junctions as orphans.

### Added — config-knob enforcement (previously declared but unenforced)

- **`MAX_FLOW_SIZE_BYTES`**: enforced in `runStagedAuthorOp` (every author tool) and in `replace_flows` / `create_flow` / `update_flow`. Throws `ValidationFailedError` when the compiled / supplied flow body would exceed the cap (default 10MB).
- **`ALLOWED_NODE_TYPES`** (comma-separated allowlist; empty = allow-all) and **`BLOCKED_NODE_TYPES`** (comma-separated denylist) — enforced in the same pipelines. Structural nodes (tab/subflow/group/comment/junction) are exempt.
- **`REQUIRE_SNAPSHOT_BEFORE_DEPLOY`** (default true): when false, `deploy_staged_change` skips the pre-deploy snapshot and returns `snapshot_before: null`. Output schema changed from `string` to `string | null`.
- **`REQUIRE_DIFF_BEFORE_DEPLOY`** (default true): refuses no-op deploys (`staged.stagedHash === runtimeHash`). Set false to allow idempotent re-deploys.
- **`SNAPSHOT_RETENTION`** (default 50): `FilesystemSnapshotStore.save()` auto-prunes the env's snapshot list down to the cap on every write. Tags `pre-dangerous` and `forced` are protected from automatic eviction.

### Changed — `list_flows` and `resolveTabId` accept either form

- `list_flows` now exposes both `id` (Node-RED tab ID) and `authoring_key` on each tab entry. They're equal when the tab was authored outside FlowOtter (no `_authoringKey` extension); they differ when FlowOtter created the tab via a template or `instantiate_template`.
- Every author tool's `tab_id` parameter now accepts either form. Internally, `resolveTabId` takes the prior flows directly and matches against both Node-RED ID and `_authoringKey`, returning the authoring key the spec uses.

### Changed — read-tier annotation overrides

- `set_target` and `export_snapshot` now declare `readOnlyHint: false, idempotentHint: false` in their MCP annotations. They mutate local state (container rebind / snapshot file), so client UIs displaying intent badges shouldn't treat them as side-effect-free.

### Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run test:unit`: 538 tests across 80 files (was 521/79; +17 new).
- `npm run test:property`: 17 tests (round-trip arbitraries extended to generate junctions + tab locked/env + group fields + comment size at 1000 random runs).
- `node scripts/check-tool-coverage.mjs`: 60/60 tools covered.
- `npm audit --omit=dev`: 0 vulnerabilities.

### Breaking changes

- `deploy_staged_change.snapshot_before` output type widened from `string` to `string | null`. Consumers that assumed a non-null string will break only when `REQUIRE_SNAPSHOT_BEFORE_DEPLOY` is explicitly set to false; default behavior is unchanged.
- Author tools that pass through a stale spec containing junctions / tab `locked` / group `position`-and-friends will now compile them into flows.json instead of silently dropping them. If any caller relied on the old lossy behavior, they'll see the new fields persist on disk.

## 1.0.1 - 2026-05-10 — Bug fix: set_target schema rejected by Anthropic API

### Fixed

- **`set_target` `inputJsonSchema`** previously declared `oneOf: [...]` at the schema root to express the admin-api / file mode split. The Anthropic Messages API rejects top-level `oneOf` / `anyOf` / `allOf` on tool input schemas, surfacing as `API Error: 400 tools.<n>.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level` and aborting the entire turn for any session that loaded FlowOtter. The schema is now a flat object with all fields optional; runtime mode validation is unchanged (still enforced by the existing `z.union([AdminApiInput, FileInput])` Zod schema).

This is a v1.0.0 regression — the toolkit remains feature-frozen.

## 1.0.0 - 2026-05-10 — Sealed Release

**FlowOtter is sealed at v1.0.0.** The toolkit is feature-frozen. Any further development moves to v2 territory and would warrant a separate decision.

### What v1.0 ships

- **60 MCP tools** across read (24), author (24), deploy (3), and dangerous (7) tiers, plus the `prepare_dangerous_operation` token issuer.
- **TypeScript authoring layer** with deterministic compile, ID preservation through `_authoringKey`, semantic diff, snapshot/rollback, drift detection, rev-mismatch retry, and partial-deploy verify-by-hash recovery.
- **`/comms` debug observer**: `get_recent_debug_messages` lazy-connects to Node-RED's WebSocket and maintains a bounded ring buffer per target. Closes the author → deploy → observe loop entirely inside the toolkit.
- **Multi-target state isolation**: `set_target` / `clear_target` re-scope snapshots/staging/audit under `~/.flow-otter/<env_name>/`. Auth tokens never persisted; `auth_env_var` reference bridges protected runtimes without leaking secrets to disk.
- **Substring-level secret redaction** in audit logging — Bearer tokens, JWTs, and long hex blobs scrubbed from any string value, with an allowlist exception for legitimately hash-shaped fields (`args_hash`, `snapshot_before`, `snapshot_after`).
- **Per-flow CRUD** in the dangerous tier (`create_flow`, `update_flow`, `delete_flow`) for atomic single-tab surgery via Node-RED's `/flow/:id` Admin API.

### Final delta from v0.7.0 → v1.0.0

| Metric                 | v0.7.0                         | v1.0.0                  | Δ      |
| ---------------------- | ------------------------------ | ----------------------- | ------ |
| MCP tools              | 52                             | 60                      | +8     |
| Unit tests             | 443                            | 521                     | +78    |
| Property tests         | 15                             | 17                      | +2     |
| Integration tests      | 69                             | 82                      | +13    |
| Test files             | 91                             | 104                     | +13    |
| Code-debt markers      | 0 (excl. naming-contract data) | 0                       | —      |
| `npm audit --omit=dev` | 0 vulns                        | 0 vulns                 | —      |
| Engine                 | node >=20.0.0                  | node >=22.0.0           | bumped |
| Runtime deps           | 8                              | 10 (+`ws`, `@types/ws`) | +2     |

### Verification artefact

`scripts/v1-readiness-check.sh` runs the full local verification matrix (11 gates: clean install, typecheck, lint, format, unit, property, integration, tool-coverage, npm pack + install + binary --version, docker build, npm audit). All gates PASSED on the v1.0 release run; output captured in `evidence/v1.0-readiness.*.txt`.

### What's explicitly NOT in v1 (sealed)

See [`docs/NON_GOALS.md`](docs/NON_GOALS.md) for the full list. Headlines: OAuth/PKCE, multi-language SDKs, streaming push, non-`debug` `/comms` topics, persistent debug buffer, ELK layout, function-node JS-IR, web UI for snapshots/audit, npm publish, public Docker registry, GitHub Actions, real-runtime validation against lab VMs / FlowFuse Cloud.

---

## 0.10.0 - 2026-05-10

Phase 3 of the sealed-v1 plan: quality, security, docs. No new tools, no new tests.

### Quality

- Zero code-debt audit: `grep -rn "TODO|FIXME|@ts-ignore|XXX|HACK" src/` returns 0 hits (excluding `naming-contract.ts` where those strings are the rule's input data). No `: any` types in `src/`.
- `npm audit --omit=dev`: 0 vulnerabilities. (5 moderate remain in dev-only deps via vite/vitest.)

### Security docs

- **`docs/SECURITY.md`** rewritten with full v1 surface coverage: tier gates, snapshots + rollback, drift checks, dangerous-token scoping (now includes per-flow CRUD tokens), substring-level secret redaction with `ALLOW_AS_KEYS` exception, multi-target state isolation, `get_recent_debug_messages` buffer leakage considerations, per-flow CRUD's staging-bypass impact, `set_links` / `set_wires` validation invariants, Node 22 engine rationale.

### New docs

- **`docs/NON_GOALS.md`** — explicit out-of-scope list. OAuth/PKCE, multi-language SDKs, streaming MCP push, non-`debug` `/comms` topics, persistent debug buffer, server-side WebSocket filtering, ELK layout, function-node JS-IR, visual-regression CI, cross-env snapshot promotion, web UI for snapshots/audit, npm publish, public Docker registry, GitHub Actions, lab-VM / FlowFuse real-runtime validation. Final list; not reopened in v1.
- **`docs/AGENT_QUICKSTART.md`** — one-page cookbook for how an AI agent drives FlowOtter, with worked examples of the author/observe/rollback loop and common failure modes.

### Updated docs

- **`README.md`** — Status section rewritten to "v1.0 — final, sealed". Lists the v1 tool surface (24 read + 24 author + 3 deploy + 7 dangerous = 58 in v0.8, but 60 with `prepare_dangerous_operation` + `get_recent_debug_messages` registered). Verification counts updated. Docs index now points at AGENT_QUICKSTART and NON_GOALS.
- **`docs/ARCHITECTURE.md`** — Layer 2 section updated to mention `NodeRedCommsClient` (the new `/comms` WebSocket adapter). The "What is intentionally not exposed" subsection clarifies that FlowOtter subscribes to `topic: 'debug'` only; other comms topics are parsed-and-discarded.
- **`docs/TOOL_REFERENCE.md`** — already updated in v0.8.0 / v0.9.0 with all 60 tools.

### Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run test:unit`: 521 (unchanged).
- `npm run test:property`: 17 (unchanged).
- `npm run test:integration`: 82 (unchanged).
- `npm audit --omit=dev`: 0 vulnerabilities.

## 0.9.0 - 2026-05-10

Phase 2 of the sealed-v1 plan: test pillars. No new MCP tools. Six new test files (5 new unit, 3 new integration, +1 setting change to Docker test stack) that close the gates which prove the v1 author/observe/rollback loop actually works.

### Test pillars

- **`tests/unit/server/tools/deploy/deploy-staged-change.failure-injection.test.ts`** — 5 mocked-`FlowSource` scenarios that exercise the deploy code's edge paths: rev-mismatch-then-retry-succeeds, network-error-but-runtime-already-matches (`recovered_from_partial`), rev-mismatch-with-drift (`DriftError`), baseline-drift-with-and-without-`force`, and cross-process stage refused unless `force_takeover`. Covers paths previously only reachable via real-network flakiness.
- **`tests/integration/multi-target-swap.test.ts`** — set_target → stage on env A → clear_target → set_target on env B (different env_name) → stage on env B. Verifies `~/.flow-otter/<env_name>/` isolation: env A's `staged.json` is untouched after env B is configured; audit logs are separate files.
- **`tests/integration/agent-journey.test.ts`** — the **v1 thesis test**. One end-to-end test driving a Node-RED instance from clean → set_target → add_debug_node staged → deployed → inject fired → debug captured via `/comms` → rollback → cleared. Closes the full loop in-toolkit without any out-of-band intervention. When this is green, the toolkit's core claim holds.
- **`scripts/check-tool-coverage.mjs`** — coverage audit that walks `src/server/tools/**/*.ts`, extracts each MCP tool name, and verifies a unit + an integration test references it. Outputs a coverage table; exits non-zero on gaps. Backfilled the 4 unit-test gaps (`rollback_last_change`, `set_flows_state`, `get_runtime_state`, `list_installed_node_types`) and 3 integration-test gaps (`add_node`, `add_dashboard_widget`, `set_flows_state`).
- **`tests/unit/server/audit/redact-regression.test.ts`** — plants Bearer tokens, JWT-shaped strings, and long hex blobs into the various `AuditEvent` fields (error message, flow_source, actor); writes the event through `JsonlAuditLogger`; asserts the persisted line contains no recognizable secret patterns. The `args_hash` allowlist exception is verified separately.

### Redactor hardening (driven by the regression test)

The pre-v0.9 redactor only stripped a string value when the ENTIRE value matched a secret pattern. An error message like `"request failed: Bearer eyJ..."` would survive intact because the string didn't START with "Bearer". v0.9 switches to **substring scrubbing**: each pattern is anchorless and `String.replace(pattern, '***REDACTED***')` is applied. Patterns now match:

- `Bearer\s+\S+` anywhere in the value
- JWT-shaped triple-segment tokens anywhere
- 32+ character hex blobs anywhere (word-bounded)

The `ALLOW_AS_KEYS` exception (`args_hash`, `snapshot_before`, `snapshot_after`) still preserves those fields verbatim — verified by a dedicated test case.

### Docker test stack

- **`deploy/node-red/settings.js`**: `runtimeState.enabled` flipped from `false` to `true`. The Node-RED `/flows/state` start/stop endpoint requires this; without it, `set_flows_state` is unusable. Now enabled by default in the test stack so `coverage-smoke.test.ts` can exercise the happy path.

### Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run test:unit`: **521 tests across 79 files** (was 506/76 at v0.8.0).
- `npm run test:property`: **17 tests across 9 files** (unchanged).
- `npm run test:integration`: **82 tests across 18 files** (was 77/15).
- `node scripts/check-tool-coverage.mjs`: 0 unit gaps, 0 integration gaps across all 60 tools.

### Hard rules respected

- Idempotency: no toolkit ops changed. Property tests still pass at `numRuns: 1000`.
- Read-only by default: no new tools added.
- Secrets redaction: hardened (substring scrubbing). Regression test guards the new behavior.

## 0.8.0 - 2026-05-10

The final feature batch before v1.0 — six new MCP tools that close the author-loop and the topology-management gap, plus a Node 22 engine bump.

### New tools

- **`get_recent_debug_messages`** (read tier) — closes the author → deploy → observe loop entirely inside the toolkit. Connects to Node-RED's `/comms` WebSocket on the first call (lazy), subscribes to topic `debug` only, maintains a bounded ring buffer (default 500 messages, override with `DEBUG_BUFFER_SIZE` env var up to 10 000), and exposes a filtered snapshot to agents. Filters: `node_id`, `flow_id`, `topic_filter` (substring), `since_ms`, `limit`. Reconnects automatically with bounded backoff (1s/2s/5s/15s/30s, max 5 attempts).
- **`set_links`** (author tier) — cross-tab pairing for `link out` / `link call` nodes. Sets `passthrough.links` on the source to the chosen `link in` peer ids (resolved from the prior compiled flows.json). Pass `target_node_ids: []` to clear the pairing. Validates types end-to-end: source must be `link out` / `link call`, every target must be `link in`, and the target must already exist as a node in the prior compiled flows.
- **`set_wires`** (author tier) — atomic bulk wire management on a regular node. Replaces all wires originating from `(source_node_id, output_port)` with new connections to the given target keys on the same tab. Pass `target_node_ids: []` to clear the port. Same-tab only — cross-tab wiring uses link nodes. Deduplicates target keys; rejects self-wire and out-of-range output ports.
- **`create_flow` / `update_flow` / `delete_flow`** (dangerous tier) — per-flow CRUD via Node-RED's `/flow` / `/flow/:id` Admin API endpoints. Each bypasses the staging pipeline but takes a pre-mutation snapshot of the full runtime first so the change is rollback-able. All three require `ENABLE_DANGEROUS_TOOLS=true` AND a `prepare_dangerous_operation` token scoped to the operation + flow body hash.

Tool count: **58** (24 read + 24 author + 3 deploy + 7 dangerous).

### Adapter

- **`src/adapters/nodered/comms.ts`** (new) — `NodeRedCommsClient` class. WebSocket client over the `/comms` endpoint. Handles both Node-RED auth handshakes: (a) `Authorization` header on the upgrade request, (b) post-open `{auth: <token>}` JSON frame for older runtimes. Parses both single-object and array-batched WebSocket frames (Node-RED 3.x batches). Lazy-connect on first tool call; `dispose()`d on `clear_target` / `set_target` swap / server shutdown.

### Container plumbing

- **`comms?: NodeRedCommsClient`** added to the `Container` interface. Constructed in `buildTargetBound` whenever `FLOW_SOURCE === 'admin-api'`. Re-built by `applyTarget` for both `kind: 'admin-api'` and `kind: 'file'`.

### Config

- **`DEBUG_BUFFER_SIZE`** env var added. Integer in [1, 10 000]; default 500.

### Dependencies + engines

- **New runtime dep: `ws@^8.20.0`** (~3MB, MIT). The built-in Node 22+ WHATWG `WebSocket` global is sufficient for an unauthenticated `/comms` connection, but its constructor does not accept custom HTTP headers — making it impossible to send `Authorization: Bearer …` on the upgrade request for authenticated Node-RED setups. `ws` is the de-facto Node WebSocket library and supports the header path natively. `@types/ws` added to deps for parity with the existing `@types/dagre` placement.
- **`engines.node` bumped from `>=20.0.0` to `>=22.0.0`.** Node 20 LTS support ended 2026-04. The bump also ensures features used by `comms.ts` (`queueMicrotask`, modern `Response` semantics in tests) are unconditionally available.

### Tests

- 22 new unit tests (12 for the comms client, 10 for the tool wrapper).
- 10 new op-level unit tests for `setLinks`, 11 for `setWires`.
- 7 new tool-wrapper tests for `set_links`, 6 for `set_wires`, 7 for per-flow CRUD (mocked fetch).
- 2 new property tests: `setLinks` idempotency + `setWires` idempotency, both at `numRuns: 200` against fast-check scenarios.
- 4 new integration tests against the Docker Node-RED stack: `get-recent-debug-messages`, `set-links`, `set-wires`, `per-flow-crud`.

### Bug fixes

- **`tests/integration/author-tools.test.ts:add_link_in_node`**: the test's default label collided with an existing `link in` named "Link In" in `BASE_FLOWS`, tripping the `link-resolution` validator that flags duplicate `link in` names. Renamed the new node's label to "Link In 2". Pre-existing failure surfaced when the Phase 1 batch ran the full integration suite for the first time post-baseline.

### Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run test:unit`: **506 tests across 76 files** (was 443/69 at v0.7.0).
- `npm run test:property`: **17 tests across 9 files** (was 15/9).
- `npm run test:integration`: **77 tests across 15 files** (was 69/13).

### Deferred to v0.9.0+

This is the last feature-shipping version before v1.0. The remaining v0.9.0 / v0.10.0 work is test pillars + quality / docs only.

## 0.7.0 - 2026-05-10

Production hardening pass: stage-pipeline refactor completed across all 21 author tools (-1510 net LOC), plus three new integration-test files covering v0.4.0 persistence/rehydration, v0.5.0 auth-env-var-ref, and v0.6.0 partial-deploy + staging-guard. No new tools, no behavior changes for callers — pure internal consolidation + test coverage for production features that were previously unit-tested only.

### Stage-pipeline refactor: mass migration complete

- All 20 remaining author tools migrated to the `runStagedAuthorOp` helper introduced in v0.6.0 (`add_debug_node` was migrated as reference then).
- Tools migrated this round: `add_inject_node`, `add_status_node`, `add_catch_node`, `add_complete_node`, `add_mqtt_in_node`, `add_mqtt_out_node`, `add_link_in_node`, `add_link_out_node`, `add_link_call_node`, `add_comment`, `add_group`, `add_subflow_instance`, `create_subflow_definition`, `update_node`, `remove_node`, `move_node`, `wire_nodes`, `add_function_node`, `add_node`, `add_dashboard_widget`, `instantiate_template`.
- **Net change: -1510 lines** across 20 files (2243 removed, 733 added). Each tool now ~50-110 LOC vs. 150-220 LOC pre-refactor.
- Every tool's input/output schema is unchanged — the migration is an internal-only restructuring. All 443 unit tests still pass without modification.
- The helper centralises the `load → decompile → op → compile → validate → lint → diff → stage → audit-enrich` pipeline. Future author tools are ~30-line wrappers.

### Integration tests — v0.4.0 + v0.5.0 + v0.6.0 features

Three new integration-test files exercise production features against the real Node-RED Docker stack:

- **`tests/integration/persisted-target.test.ts`** — verifies (a) `target.json` written after `applyTarget` + `persistAppliedTarget`, (b) per-env_name state-directory isolation across two concurrent containers, (c) cross-process rehydration (second container with same `ENVIRONMENT_NAME` picks up the persisted target without re-calling `set_target`), (d) explicit `NODE_RED_BASE_URL` env var suppresses rehydration (operator pin wins). Asserts the hard rule that auth tokens never appear in `target.json`.
- **`tests/integration/auth-env-var-ref.test.ts`** — verifies the v0.5.0 auth env-var-ref scheme: (a) `target.json` stores the variable NAME but the token VALUE never appears anywhere on disk, (b) rehydration at boot reads the env var to populate auth, (c) missing env var produces a warn but does not crash (rehydration continues without auth).
- **`tests/integration/deploy-recovery.test.ts`** — verifies the v0.6.0 deploy fixes: (a) happy-path deploy reports `takeover:false`, `recovered_from_partial:false`, `retried_on_rev_mismatch:false`, (b) cross-process `staged.agent_id` mismatch is refused, (c) `force_takeover:true` succeeds and surfaces `takeover:true` in the output.

The partial-deploy verify-by-hash and rev-mismatch retry paths from v0.6.0 use injected fetch mocks; their happy-path is covered by the integration above, while the failure-injection edge cases are unit-tested with mocked fetch.

### Verification

- `npm run typecheck`, `npm run lint` clean.
- `npm run test:unit`: 443 passed (unchanged from v0.6.0).
- `npm run test:property`: 15 passed.
- `npm run test:integration`: new tests compile cleanly; run via Docker stack (existing `deploy/docker-compose.yml`).
- `npm run build`: artifacts unchanged in count; per-file sizes shrunk for migrated author tools.

### Deferred to v0.8.0+

- **`get_recent_debug_messages`** — Node-RED `nr-comms` WebSocket integration (non-trivial; needs reconnect logic and ring-buffer caching).
- **`set_links`** topology tool — `update_node` passthrough editing covers the common case; ship if/when an agent trips on it.
- **Partial-deploy / rev-race unit tests with injected fetch mocks** — strengthen the verify-by-hash path with red-team scenarios (mid-flight TCP drop, 502 from a flaky reverse proxy).
- **OAuth/PKCE auth strategy** for FlowFuse-hosted Node-RED targets (reference impl in `~/Projects/reference/flowfuse/nr-assistant/lib/auth/index.js`).
- **Per-flow CRUD tools** (`get_flow`/`create_flow`/`update_flow`/`delete_flow`) — Admin API endpoints stable since Node-RED 0.19; not yet exposed at the MCP layer.

## 0.6.0 - 2026-05-10

Closes most of v0.5.0's "Deferred to v0.6.0+" queue: Dashboard 2.0 widget breadth (14 new widget types reachable), MCP-spec annotation hints for client interop, line-based patches on `update_node`, the destructive-action validator that completes the v0.5.0 confirmed-button pattern, stage-pipeline helper, per-session staging guard, partial-deploy + rev-race fixes. Same-day follow-up to v0.5.0.

### New tools

- **`add_dashboard_widget`** (author tier): typed creation for **14 Dashboard 2.0 widget types** previously unreachable cleanly — `ui-dropdown`, `ui-radio-group`, `ui-slider`, `ui-switch`, `ui-text-input`, `ui-number-input`, `ui-file-input`, `ui-markdown`, `ui-progress`, `ui-audio`, `ui-spacer`, `ui-event`, `ui-link`, plus dialog-mode `ui-group` as a config-node variant. Per-widget Zod schemas in `src/toolkit/authoring/widget-schemas.ts`. Anchor resolution per type (`group`, `ui`, `none`, or `config` for dialog).

### MCP-spec annotation hints on Tool interface

- New `ToolAnnotations` type (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` / `title`) per MCP 2025-03 spec. Sensible per-tier defaults derived by `defaultAnnotationsForTier` — read/validate = readOnly+idempotent, author/stage = mutates-local-not-runtime, deploy = destructive+open-world, dangerous = same as deploy. Per-tool overrides supported via optional `annotations` field on `Tool`.
- Stdio transport propagates annotations on `tools/list` so Claude Desktop / Cursor / other MCP clients can surface the right intent badges in their UI.

### Line-based patches on `update_node`

- `update_node` now accepts `patches: [{property, op:'replace'|'insert'|'delete', start, end?, content?}]` for **token-efficient edits to long-string passthrough fields** — function-node `func`, ui-template `format`, template-node `template`. Line numbers are 1-indexed on the ORIGINAL content; non-overlapping patches required (throws `PatchError` on overlap). Per-property batches: passthrough merge first, then patches. Mirrors FlowFuse Expert's design.
- New helper `src/toolkit/authoring/operations/_patches.ts` with `applyPatches(original, patches)`.

### Destructive-action validator

- New `dashboard-2-destructive-needs-confirm` rule. Flags `ui-button`/`ui-button-group` whose payload values match destructive vocabulary (`abort|stop|estop|emergency-stop|shutdown|reset|trip|kill|halt`) — OR whose labels match destructive patterns — when not paired with a confirmation widget (`ui-template` or a node with `_authoringKey` containing `confirm`) in the same `ui-group`. Severity: warning. Completes the v0.5.0 `dashboard_2_confirmed_button` template story by adding the lint-side enforcement. Standards anchor: ISA-18.2 §11.13.

### Stage-pipeline helper

- New `src/server/tools/author/_stage-pipeline.ts` extracts `runStagedAuthorOp` — the shared `load → decompile → op → compile → validate → lint → diff → stage → audit-enrich` boilerplate every author tool repeats. Plus helpers `resolveTabId`, `resolveAuthoringKey`, `findNewNodeId`.
- `add_debug_node` migrated to the helper as a reference implementation (215 LOC → 140 LOC). Mass-migration of the other 20 author tools deferred to a follow-up session — mechanical per-tool work.

### Per-session staging guard

- `StagedChange` schema gains optional `agent_id: string` field. `Container` gains `agentId: string` derived at boot from `FLOWOTTER_SESSION_ID` env var (else `pid-${process.pid}`).
- Author tools (via the new stage-pipeline helper) tag every staged change with `agent_id`.
- `deploy_staged_change` refuses to deploy when `staged.agent_id !== ctx.agentId` — protects parallel sessions sharing the same `env_name` from clobbering each other's stages. Caller can override with `force_takeover: true`. Pre-v0.6.0 staged.json files (no `agent_id`) deploy normally for back-compat.
- New output fields: `takeover: boolean`.

### Partial-deploy + rev-race fixes

- `deploy_staged_change` now handles two production-correctness gaps:
  - **Rev mismatch race**: if `save()` throws `RevMismatchError` (and not `force`), re-fetch the runtime, compare its hash to `runtimeHash` (our pre-deploy baseline). If unchanged, retry once with the new rev. Sets `retried_on_rev_mismatch: true` in output.
  - **Partial-deploy / network split**: if `save()` throws any other error, re-fetch the runtime and check whether its hash equals `staged.stagedHash`. If yes, the server DID accept the deploy but the response failed to reach us — treat as success, clear staging, return ok. Sets `recovered_from_partial: true` in output.

### Anti-hallucination + auth env-var-ref (carry-overs)

- `list_installed_node_types` extended in v0.5.0 — unchanged in v0.6.0, but the `widget-schemas.ts` registry now also informs agents which Dashboard 2.0 widget types FlowOtter can validate.

### Tests

- 443 unit + 15 property tests passing. New this round:
  - `_tool.annotations.test.ts` — 7 tests (per-tier defaults + per-tool override merge).
  - `add-dashboard-widget.test.ts` — 11 tests (group-anchored widgets + ui-link/ui-event/ui-group-dialog special-anchor cases + unknown-type rejection).
  - `patches.test.ts` — 11 tests (replace/insert/delete + overlap detection + range validation).
  - `dashboard-2-destructive-needs-confirm.test.ts` — 7 tests (positive + negative + label-heuristic cases).

### Verification

- `npm run typecheck`, `npm run lint` clean.
- `npm run test:unit`: 443 passed (was 412 pre-session; +31 new tests).
- `npm run test:property`: 15 passed.
- `npm run build` produces `dist/` artifacts for all new modules.

### Deferred to v0.7.0+

- **Mass migration of 20 remaining author tools to the stage-pipeline helper**. Mechanical per-tool work; defer to focused session so test churn is bounded.
- **Integration tests for v0.4.0 + v0.5.0 + v0.6.0 against a real Node-RED** (Docker stack). The partial-deploy recovery path especially benefits from real network-failure scenarios.
- **`get_recent_debug_messages`** — Node-RED `nr-comms` WebSocket integration.
- **`set_links`** topology tool — currently subsumed by `update_node` passthrough editing.

## 0.5.0 - 2026-05-10

Project-independence pass + new authoring primitives + ISA-101-grounded industrial defaults. Same-day follow-up to 0.4.0. Reframes FlowOtter from "agent-side flow authoring" to "agent-side flow authoring with opinionated, standards-grounded defaults for any project."

### Mission clarification

- **FlowOtter is project-independent.** Its purpose is giving any AI agent the ability to manipulate Node-RED flows + Dashboard 2.0 dashboards across any project, any user, any runtime. Specific projects are consumers; the tool is not built for any one of them. Docs use generic examples throughout: `http://192.168.1.10:1880`, `factory-line-a`, `home-automation` style.

### New tools

- **`add_node`** (author tier): generic node-add taking `{tab_id, type, opts: {key?, label?, position?, group_key?, passthrough?, source_node_id?, source_output_port?}}`. Per-type Zod schemas in `src/toolkit/authoring/node-schemas.ts` cover `change`, `switch`, `template`, `delay`, `trigger`, `http in`, `http response`, `http request`, `csv`, `json`, `xml`, `file in`, `file`, `exec`, `comment` (15 schemas). Unknown types accept arbitrary `passthrough` with `type_had_schema: false` warning in the response.
- **`set_flows_state`** (deploy tier): toggle Node-RED runtime via `POST /flows/state {state: 'start' | 'stop'}`. Returns `404` mapped to `FeatureDisabledError('runtimeState.disabled')` when `runtimeState.enabled = true` is not set in Node-RED settings.js. The third primitive for safe rollouts against hardware-controlling flows: stop → deploy → start.

### Tool-output cleanup

- **Stripped `svg_before`/`svg_after` from every author-tool response** (20 author tools). The SVG fields were rendering kilobytes of flow-graph topology per call — pure context tax that agents don't read. `render_flow_svg` remains as an opt-in read-tier tool. Total: 140 lines of code removed from `src/server/tools/author/*.ts`, 56 lines from tests.

### Defaults shifted to ISA-101 high-performance HMI

- **`ensureSkeleton` accepts a new `preset` parameter**, defaulting to `'industrial'` (grayscale base — `bgPage:#dddddd`, `groupBg:#f6f6f6`, `primary:#404040`, `compact` density, `2px` radii). Saturated color reserved for _abnormal_ state per ISA-101. Two alternative presets: `'ops_dark'` (dark control-room variant) and `'flowfuse_default'` (preserves out-of-box cyan look for consumer-IoT).
- **Five new industrial-grade templates ship as first-class citizens** (not opt-in vertical — these are good engineering defaults even when not required):
  - `dashboard_2_alarm_panel` — `ui-table` driven by ISA-18.2 state-machine function node (UNACK → ACK → RTN → SHELVED). MQTT topic convention `alarms/<area>/<priority>`.
  - `dashboard_2_confirmed_button` — `ui-template` hold-to-confirm (default 2 seconds) for destructive actions. Operator-error prevention for stop/abort/e-stop/shutdown/reset.
  - `dashboard_2_mode_banner` — `ui-template` strip showing AUTO/MANUAL + LOCAL/REMOTE + LOCKOUT. Saturated red only when LOCKOUT true.
  - `dashboard_2_live_value` — `ui-template` wrapping any numeric/text value with a stale-data badge (default 5s threshold). Operator can tell at a glance if the reading is fresh.
  - `dashboard_2_audit_log_tail` — `ui-table` showing last N operator actions from a topic-driven stream. Operator-visible "what just happened" surface.

### Generic gauge grid

- **`dashboard_2_gauge_grid`** template metrics changed from V/I/P/E (EV-charging-specific) to Temperature/Pressure/Flow/Level (generic process metrics, sensible defaults for any IoT/industrial application).

### Auth env-var-ref scheme (in persistence layer)

- **`set_target` accepts `auth_env_var: string`** — name of an environment variable holding the bearer token for protected admin-api targets. Resolved at `set_target` time AND at boot-time rehydration. The **value itself is never persisted to disk** — only the variable name. Unblocks "one MCP registration serves N protected targets without leaking secrets" (`persistAppliedTarget` extended; `rehydrateFromPersistedTarget` reads the env var from `process.env`).
- `target.json` schema gains optional `auth_env_var` field. Existing target.json files continue to work — purely additive.

### Anti-hallucination hint on palette inventory

- **`list_installed_node_types`** output extended with `typed_modules: [{type, has_schema}]` and `flow-otter_known_typed_types: string[]`. Agents authoring via `add_node` can check `has_schema: true` to know FlowOtter will validate their passthrough against a strict Zod schema (vs. accepting arbitrary fields for unknown types).

### Bug fixes

- **`User-Agent` constant in `src/adapters/nodered/client.ts:27`** no longer hardcodes `FlowOtter/0.3.0`. The constant is now a `'FlowOtter/unknown'` fallback; `container.ts` injects `FlowOtter/${serverVersion}` when constructing `NodeRedClient`. Verified by new unit tests in `tests/unit/adapters/nodered/client.test.ts`.

### Tests

- 403 unit + 15 property tests passing. New: 6 unit tests for `add_node`, 2 unit tests for User-Agent injection.
- 5 new templates added to the `BUILTIN_TEMPLATES` catalog (count 22 → 27).
- All edited files prettier-formatted; typecheck + lint clean.

### Deferred to v0.6.0+

The following landed-in-scope-but-deferred items are tracked for follow-up sessions, in priority order:

- **`add_dashboard_widget`** — typed widget creation for 14 missing Dashboard 2.0 widget types (`ui-dropdown`, `-radio-group`, `-slider`, `-switch`, `-text-input`, `-number-input`, `-file-input`, `-markdown`, `-progress`, `-audio`, `-spacer`, `-event`, `-link`, dialog-mode `ui-group`).
- **Line-based `patches` on `update_node`** — `{property, op:'replace'|'insert'|'delete', start, end?, content?}` for token-efficient function-node JS / `ui-template` HTML edits.
- **MCP-spec annotation hints** (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) on Tool interface. Interop with Claude Desktop / Cursor / other MCP clients that respect these.
- **Stage-pipeline refactor** — extract `runStagedAuthorOp` helper; collapse 21 author tools' boilerplate. ~3000 LOC reduction.
- **Partial-deploy + drift-race fixes** in `deploy_staged_change` (post-deploy verify-by-hash; retry-once on rev-mismatch).
- **Per-session staging guard** — `staged.actor` mismatch check.
- **Destructive-action validator** — lint rule flagging `ui-button`/`ui-button-group` with destructive payload verbs not paired with a confirmation widget. (Templates ship; lint enforcement pending.)
- **`get_recent_debug_messages`** — needs Node-RED `nr-comms` WebSocket integration.
- **`set_links`** topology tool — currently subsumed by `update_node` passthrough editing.
- **Integration tests for v0.4.0 persistence + rehydration** against a real Node-RED.

## 0.4.0 - 2026-05-10

Persisted target + file-source `set_target` so a single MCP registration can serve N parallel sessions, each pointing at its own Node-RED runtime, with target binding surviving process restarts.

### New tools

- **`clear_target`** (read tier): removes `~/.flow-otter/<env_name>/target.json` so the next process boot does NOT rehydrate. Optional `revert_in_memory:true` re-points the live container to a file source.

### `set_target` extensions

- Discriminated input union now accepts file-source switching: `{ flow_source: "file", file_path, env_name? }`. Existing admin-api shape (bare `base_url`, with optional `auth_token`/`username`/`password`) is back-compat preserved.
- After a successful apply, writes `~/.flow-otter/<env_name>/target.json` so the next process boot rehydrates the same target. Pass `persist:false` to skip for ephemeral swaps.
- Auth tokens, basic-auth credentials, and override directories are **never** persisted (matches the "no secrets" hard rule). Auth must come from MCP-registration env vars or be re-supplied via `set_target` each session.
- Output gains `flow_source` discriminant, optional `file_path`, `persisted` boolean, `persisted_target_path`.

### Persistence layer

- New `src/server/state/persisted-target.ts` — atomic write (temp-file + rename), Zod-validated read with `parse-error`/`schema-mismatch`/`io-error` warnings, sorted-key 2-space JSON.
- Per-`env_name` scope: `~/.flow-otter/<env_name>/target.json` parallel to existing `snapshots/`, `staging/`, `audit.jsonl`.
- Schema versioned (`schema_version: 1`); future migrations are additive.

### Boot rehydration

- New `rehydrateFromPersistedTarget(container, env)` runs once at server startup. Resolution order:
  1. Explicit `NODE_RED_BASE_URL` env var → admin-api wins, no rehydrate.
  2. Explicit `FLOW_FILE_PATH` env var → file wins, no rehydrate.
  3. Persisted `~/.flow-otter/<ENVIRONMENT_NAME>/target.json` → apply.
  4. Default file source (`./flows.json`).
- `health_check` adds `env_name`, `persisted_target_path`, `persisted_target_age_seconds` so agents can self-diagnose rehydration state.

### `applyTarget` generalization

- `ApplyTargetOptions` is now a discriminated union (`{ kind: 'admin-api', ... } | { kind: 'file', ... }`). `AppliedTarget.flow_source` is `'admin-api' | 'file'`.
- File mode derives `env_name` from `<parent-dir-basename>_<6-char-sha256>` when not supplied — disambiguates two projects with a `flows.json` at the same path basename.

### Tests

- `tests/unit/server/state/persisted-target.test.ts` (14 tests): round-trip both kinds, malformed JSON, schema-mismatch, env-mismatch, atomic write (no `.tmp` leftovers), byte-stable JSON formatting.
- `tests/unit/server/rehydrate.test.ts` (7 tests): rehydrate both kinds, suppress on explicit env vars, parallel `env_name` isolation (the "10 parallel sessions" path), corrupt-file warning surfacing.
- `tests/unit/server/tools/read/clear-target.test.ts` (5 tests).
- Extended `tests/unit/server/tools/read/set-target.test.ts` (now 14 tests): file-source mode, persistence default + opt-out, both kinds.
- `tests/property/persisted-target-roundtrip.test.ts` (3 properties × 200 runs): round-trip equality + write byte-stability.

### Docs

- New `docs/PARALLEL-SESSIONS.md` covering the three deployment shapes for many-sessions-many-targets: one global registration + persisted `set_target`, per-project `.mcp.json`, baked-in registration. Auth limitation documented.
- `docs/TOOL_REFERENCE.md`: tool count 49 → 50; `set_target` and `clear_target` documented.

### Verification

- `npm run typecheck`, `npm run lint` clean.
- `npm run test:unit`: 395 passed.
- `npm run test:property`: 15 passed.
- `npm run build` produces `dist/src/server/state/persisted-target.js` + `dist/src/server/tools/read/clear-target.js`.

## 0.3.0 - 2026-05-08

Audit + research-driven correctness pass against Node-RED 4.x. All findings
fixed in this round per the project's "no MVPs" rule; no items deferred.

### Admin API client

- **F-002 (BLOCKER) fixed**: `POST /flows` 409 body shape. Node-RED returns
  `{code:"version_mismatch", message:""}` — no `rev` field. Dropped the dead
  body parse; `RevMismatchError` no longer carries a misleading `actualRev`.
  Callers needing the new rev re-issue `GET /flows`.
- **F-001 (BLOCKER) fixed**: `POST /flows` body now forwards a `credentials`
  field when supplied (`SaveOptions.credentials`). Closes the silent gap when
  authoring tools want to push per-node secrets.
- **F-003/F-004 (HIGH) fixed**: removed dead v1 GET /flows fallback that read
  `x-rev`/`rev` headers Node-RED never sends. Pre-0.15 Node-RED is unsupported.
- **F-005 (HIGH) fixed**: 401 vs 403 disambiguation. New `FeatureDisabledError`
  for 403 responses with `{code:"<x>.disabled"}` (e.g. `diagnostics.disabled`).
  401 still maps to `AuthFailedError`.
- **F-013 (HIGH) fixed**: `expires_in` fallback bumped from 3600s to 604800s
  (Node-RED's adminAuth `sessionExpiryTime` default).
- **HIGH fixed**: 401 now invalidates the cached token and retries once with a
  fresh grant. Avoids the 401 loop after a Node-RED restart that cleared
  `.sessions.json`. Auth reissue gets its own retry slot — does not consume the
  5xx retry budget.
- **F-035 (LOW) fixed**: `User-Agent: FlowOtter/<version>` header on every request.
- Added single-flow CRUD on `NodeRedClient`: `getFlow(id)`, `createFlow(flow)`,
  `updateFlow(id, flow)`, `deleteFlow(id)`. Stable in Node-RED since 0.19. Right
  primitive for incremental authoring without full-document round-trips.

### Auth

- `NodeRedAuth.getAuthHeader()` now returns `{name, value}` so reverse-proxy /
  SSO setups using `adminAuth.tokenHeader` can send the token under a custom
  header. `BearerAuth` and `PasswordGrantAuth` accept an optional `headerName`
  option; `NODE_RED_AUTH_HEADER` env var wires it through `authFromEnv`.
- New `NodeRedAuth.revoke()` method. `PasswordGrantAuth.revoke()` issues
  `DELETE /auth/revoke` to free the server-side `.sessions.json` slot. Called
  on shutdown and on `set_target` switch.
- New `probeAuthLogin(baseUrl)` helper to discover the auth scheme and
  `tokenHeader` from `GET /auth/login`.

### Schema (`src/shared/flows-json.ts`)

- **BLOCKER fixed**: `junction` (Node-RED 3.0+) added to `RESERVED_TYPES` with
  its own discriminator (`JunctionNodeSchema`, `isJunction`). Junctions used to
  slip through `genericNode` and produce malformed flows.
- **HIGH fixed**: schema additions on regular nodes — `d` (per-node disabled,
  distinct from tab-level `disabled`), `l` (link-label visibility), `info`
  (per-node annotation, 4.1+), and inline `credentials`. Previously hidden
  behind `.passthrough()`, now typed.
- **HIGH fixed**: tab `locked` (3.1+), group `info` (4.1+) and `g` (nested
  group parent, 3.0+) typed.
- **HIGH fixed**: subflow definition shape — `meta`, `status`, `inputLabels`,
  `outputLabels`, and a typed env enum `{str, num, bool, json, env, cred,
jsonata, conf-type}` (`conf-type` added 4.0, `#4587`). New
  `SubflowEnvEntrySchema` and `SubflowPortSchema`.

### Compiler

- **BLOCKER fixed**: subflow-instance `wires` now sized from the referenced
  subflow definition's `passthrough.out.length`. Previously fell through to 1
  and produced wrong-shape flows that the validator caught post-compile.

### Decompiler

- **HIGH fixed**: `STRUCTURAL_FIELDS` now strips `_users`, `_alias`, and
  inline `credentials` on round-trip. The `credentials` strip is a
  secret-leak fix.

### Validators

- **HIGH fixed**: `link-resolution` now recognises `linkType: "dynamic"` (Node-RED
  3.0+) and skips static-target checks for those nodes. New check: duplicate
  `link in` names per tab — ambiguous under dynamic-mode resolution.

### Templates (`src/toolkit/templates/builtin.ts`)

- **HIGH fixed**: `dashboard_status_panel` was emitting Dashboard 1.0 type IDs
  (`ui_base`, `ui_page`, etc.) on a 2.0 hierarchy. Fixed to hyphenated forms
  (`ui-base`, `ui-page`, ...). Dashboard 2.0 silently ignored the old shape.

### Tools

- `health_check` now also returns a `warnings[]` array sourced from
  `flowSource.inspectWarnings()`. Surfaces project-mode flowFile mismatches
  (file source) and active-projects-mode info (admin-api source).
- `get_runtime_state` now reports `safe_mode` (orthogonal to `start`/`stop`,
  sourced from `diagnostics.runtime.safeMode`) and `runtime_state_enabled`.
  Tool description updated to clarify state values are verbs (`start`/`stop`),
  not adjectives.

### FlowSource interface

- New `inspectWarnings()` method on `FlowSource`. Returns `FlowSourceWarning[]`
  with `code`/`message`/`hint`. File source detects the
  `editorTheme.projects.enabled` footgun (existence of `projects/` sibling).
  Admin-api source queries `/diagnostics` for `runtime.projects.enabled`.

### Container

- `Container.auth` now exposed so the shutdown path can call `auth.revoke()`
  without traversing client internals. `applyTarget` (set_target) revokes the
  prior auth before swapping in the new one.

### Docs

- `docs/research/{admin-api,flows-json-schema,authentication,dashboard-2,advanced-features,api-correctness-audit}.md` —
  six version-stamped reference documents produced by parallel research
  agents + a max-effort Opus correctness auditor. The audit yielded 41
  findings across 5 severity levels.
- `docs/research/upstream-issues-to-file.md` — 4 docs/source gaps to file
  with `node-red/node-red`.
- `docs/ARCHITECTURE.md` — added "What is intentionally not exposed" section
  documenting hooks, context storage, and `/comms` non-coverage.

### Dashboard 2.0 round

Same release. Lands the work the audit pass deferred — the 11 templates, 4
validators, and the typed reference shape called for in
`docs/research/dashboard-2.md`.

- **NodeSpec typed reference shape**. New `WidgetAnchorKind = 'group' | 'page'
| 'ui'` and `WidgetAnchor { kind, refKey }`. `NodeSpec.widgetAnchor?` lets
  Dashboard 2.0 widget templates encode the three reference variants
  (`ui-template` with `templateScope='widget:ui'` anchors to `ui-base`;
  `'widget:page'` anchors to `ui-page`; default scope anchors to `ui-group`).
  The compiler resolves it: `kind === 'group'` emits `passthrough.group =
compiledConfigId(refKey)`, similarly for `'page'` and `'ui'`.
  Backward-compatible — when `widgetAnchor` is absent, the existing
  `passthrough.group` path still works.
- **11 new built-in templates** in `src/toolkit/templates/builtin.ts`:
  `dashboard_2_skeleton` (ui-base + ui-page + ui-theme + ui-group, no
  widgets); `dashboard_2_status_panel` (renamed + corrected from the v0.3.0
  `dashboard_status_panel`; ui-text reading `{{msg.payload}}`);
  `dashboard_2_telemetry_chart` (ui-chart, line, time-axis);
  `dashboard_2_command_panel` (ui-button-group + ui-text + ui-notification —
  for typical operator command / notification pages);
  `dashboard_2_form_input` (ui-form with three typed fields wired into a
  function and debug); `dashboard_2_gauge_grid` (4× ui-gauge V/I/P/E in a
  12-col group); `dashboard_2_table_log` (ui-table on payload arrays);
  `dashboard_2_dual_theme` (two ui-theme nodes + ui-button + ui-control
  toggle); `dashboard_2_multi_page` (one ui-base, three ui-pages with their
  own groups — for multi-page operator console topologies);
  `dashboard_2_template_widget` (ui-template Vue 3 component scaffold,
  `templateScope='widget:group'`); `dashboard_2_custom_css` (ui-template,
  `templateScope='site:style'`, anchored to ui-base). Templates are
  composable via the new `findExistingConfigKey(base, type)` and
  `ensureSkeleton(...)` helpers — instantiating `dashboard_2_skeleton` then
  `dashboard_2_telemetry_chart` (or any other widget template) reuses the
  skeleton's `ui-base/ui-page/ui-theme/ui-group` instead of stamping
  duplicates.
- **4 new validators** in `src/toolkit/validate/rules/`:
  `dashboard-2-hierarchy` (every `ui-page` references a `ui-base`; every
  `ui-group` references a `ui-page`; every widget references a `ui-group`,
  with the documented exceptions for `ui-template` non-group templateScopes,
  `ui-control`, and `ui-event`); `dashboard-2-required-fields` (per-type
  required fields per the research doc §3 table; one diagnostic per missing
  field); `dashboard-2-group-width-fits` (`widget.width <= group.width` and
  per-row sum-of-widths fit, ordered greedily by `order` and id);
  `dashboard-2-mixed-versions` (warning, not error, when `flows.json`
  contains both `ui_*` (1.0) and `ui-*` (2.0) types — encourages migration
  via `@flowfuse/node-red-dashboard-2-migration`).

## 0.2.0 - 2026-05-08

- Renamed the project to **FlowOtter** (npm package `flow-otter`, bin `flow-otter`); previously
  `node-red-mcp`. Functionality unchanged — the rename keeps MCP client lists unambiguous.
- Added `set_target` (read-tier) tool: agent can switch the active Node-RED Admin API target at
  runtime. Re-scopes snapshot/staging/audit storage under `~/.flow-otter/<env_name>/` per target.
- Server now boots without `NODE_RED_BASE_URL`. `FLOW_SOURCE=admin-api` no longer requires a URL
  at config-load time; tools that need a live target fail with a clear "call set_target first"
  message until configured.
- `ToolContext` now exposes `container` (live mutable container reference) so tools that mutate
  target-bound state can do so coherently.

## Unreleased

- Clarified the project-agnostic MCP target model and added multi-project agent configuration
  guidance.

## 0.1.0 - 2026-05-01

- Added the deterministic Node-RED authoring toolkit with compile/decompile, validators, linting, snapshots, staging, diffing, layout, SVG rendering, naming contracts, and templates.
- Added the MCP server over stdio with explicit read, author, deploy, and dangerous tool tiers.
- Added 49 total tools when all tiers are enabled.
- Added Docker-backed integration tests for read tools, authoring, staging/deploy/rollback, drift detection, templates, dangerous delete rollback, and multi-edit ID preservation.
- Added `flows-lint` and `node-red-mcp --version`.
- Added docs for architecture, tool reference, and security.
