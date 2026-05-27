# Verification Roadmap — Building Durable Correctness in FlowOtter

> **Status:** proposed, not yet started.
> **Audience:** maintainers and contributors planning post-v1.3 work.
> **Companion docs:** [`ARCHITECTURE.md`](ARCHITECTURE.md), [`NON_GOALS.md`](NON_GOALS.md), [`REDESIGN_PLAN.md`](REDESIGN_PLAN.md).

## Why this document exists

FlowOtter v1.3.0 ships a structured authoring layer for Node-RED — staging, validation, snapshots, atomic deploys, ISA-101 dashboard validation, MCP elicitation gating destructive operations. The 738 unit + 17 property tests + 82 integration tests give strong **structural** verification: the toolkit compiles deterministically, validators catch known anti-patterns, the safety surface enforces tier gates.

What v1.3.0 does **not** ship is **behavioral verification at scale** — proof that each tool, when called with a given input by an autonomous LLM agent, produces the correct effect against a live Node-RED runtime, in a way that is reproducible across consumer-model versions.

The thesis driving this roadmap: **tool correctness is invariant under LLM improvement.** Consumer models (Claude, GPT, Gemini, etc.) will continue to improve at calling tools — that progress is upstream of any MCP server. What FlowOtter owns, and is judged on, is whether the tools themselves do the right thing when called. That property is testable, durable, and worth investing in for its own sake.

This document defines a multi-wave program to build the verification infrastructure that proves it.

---

## Strategic frame

FlowOtter's capability surface splits into two categories with very different lifetime value:

### Durable capabilities (do not depreciate as consumer models improve)

These are about *system properties*, not model intelligence. They scale in importance as agents are trusted with bigger work.

- **Transactional infrastructure** — snapshot, drift detection, staging, rollback, audit log
- **ID stability across runs** (the `_authoringKey` mechanism)
- **Structural validators** — catch ill-formed output regardless of how smart the author was
- **Layout engine** (dagre/elkjs) — computational, scales superlinearly with flow size
- **Visual diff (render_flow_svg + diff)** — the only viable human-review interface at scale
- **Elicitation primitives** — about user control, not agent capability
- **Flow-specific navigation tools** (`search_nodes`, `get_subflow`, `analyze_flow`) — these are about navigating *a specific large artifact*, which no amount of model intelligence pre-loads
- **Behavioral test layer** (proposed; this roadmap)

### Depreciating capabilities (less valuable as consumer models improve)

These help today's models compensate for blind spots that future models won't have.

- Generic node-type catalog entries
- Methodology playbooks (`plan_flow` instructions, response-side nudges)
- Soft guidance for forgetful agents
- Reference documentation embedded in tool outputs

This roadmap prioritizes durable capabilities. **Knowledge-layer expansion is deferred** and should be motivated by measured failure modes from the eval loop, not added preemptively.

---

## Current verification surface (baseline before this program)

What exists in v1.3.0:

- **Toolkit unit tests** (`tests/unit/`) — 738 tests covering compile/decompile, validators, layout, diff, templates
- **Property tests** (`tests/property/`) — 17 tests at `numRuns:1000` for round-trip idempotence (junctions, tab `locked`/`env`, group geometry, comment size, layout determinism)
- **Integration tests** (`tests/integration/`) — 82 tests against a Docker-stacked Node-RED + Mosquitto, with a `seedFixture()` helper that POST-replaces flows between tests
- **Structural validators** — link resolution, dashboard hierarchy, group consistency, on-grid, label-cap, off-canvas, naming contract, function syntax (acorn), secret patterns, ISA-101 operator-screen rules
- **Audit log** — every authoring action recorded to `~/.flow-otter/<env_name>/audit.jsonl` with `tool`, `result`, `actor`, `environment`, `server_version`

What is **not** verified today:

1. That an autonomous agent driving FlowOtter from natural-language tasks produces correct flows at scale
2. That FlowOtter version changes (new tool, refined description, new nudge, added validator) measurably improve correctness rather than introducing regressions
3. That deployed flows actually exhibit the intended behavior under controlled input stimulus
4. That nudges, methodology guidance, and elicitation prompts achieve their stated effect

This roadmap closes those four gaps.

---

## The program — five waves

Each wave delivers production-quality work (full tests, full docs, full audit-log integration). No MVPs in the throwaway sense; each wave is shippable on its own. Wave ordering is dictated by dependency, not size.

| Wave | Goal | Unblocks |
|------|------|----------|
| 1 | Close FlowOtter introspectability gaps | Waves 2-5 |
| 2 | Build the verification harness | Waves 3, 5 |
| 3 | Curate initial corpus + first eval run | Wave 5 |
| 4 | Expand elicitation coverage | Verified by Wave 5 |
| 5 | Operationalize per-release runs | — |

---

### Wave 1 — Close the introspectability gaps

**Goal:** make FlowOtter introspectable enough to be evaluated. Today, two runs against different FlowOtter builds are indistinguishable in the audit log; nudges fire but aren't recorded; sandbox reset is not a first-class operation; behavioral testing has no stimulus primitive. These four sub-tasks are precondition for any downstream eval loop.

#### 1.1 — Audit log provenance

**Problem.** `AuditEvent` in `src/server/audit/schema.ts:34-53` has `server_version` (set from `package.json` `"1.3.0"`) and `actor`/`environment`, but no `session_id`, `task_id`, `prompt_text_hash`, `git_commit`, or `node_version`. `server_version` is the static semver string — identical for every commit on the v1.3.x line — so two runs against different builds are indistinguishable.

**Changes.**
- Extend `AuditEventSchema` in `src/server/audit/schema.ts:34` with optional fields: `session_id` (UUID string), `task_id` (string), `prompt_text_hash` (sha256-truncated), `git_commit` (40-char hex), `node_version` (string).
- Inject a build-time constant `BUILD_COMMIT` via a small script that runs `git rev-parse HEAD` and writes it into `dist/`. Stamp `SERVER_INFO` in `src/server/container.ts:175` with the commit.
- Accept `--session-id` and `--task-id` CLI flags in `src/server/index.ts:107`, propagate through `Config`.
- Update all audit-event creation sites to populate the new fields when present.
- Tests covering: schema acceptance of the new fields, BUILD_COMMIT injection at build time, CLI flag parsing, audit-event population.

**Acceptance.**
- Audit events from two builds of FlowOtter on the same source tree contain different `git_commit` values.
- Audit events from two agent sessions in the same build contain different `session_id` values.
- Existing audit consumers continue to work (the new fields are optional).

**References.** `src/server/audit/schema.ts`, `src/server/audit/jsonl.ts`, `src/server/container.ts`, `src/server/index.ts`.

---

#### 1.2 — Structured nudge event log

**Problem.** Nudges fire in `src/server/tools/_tool.ts:199-231` and append `_guidance: string[]` to the tool response, but the nudge firings are not recorded in the `AuditEvent` (`_tool.ts:242-258` builds the event without referencing `guidance`). A downstream grader cannot ask "which nudge fired, did the agent act on it, did it course-correct."

**Changes.**
- Add `nudges_fired: { id: string; message: string; fired_at: string }[]` to `AuditEventSchema` in `src/server/audit/schema.ts:34`.
- Capture the guidance array inside the try-block at `src/server/tools/_tool.ts:222`; pass it through `enrichments` so it is persisted to the audit log.
- Add an `id` field to nudge definitions in `src/server/nudges/registry.ts` so each fired nudge has a stable identifier (not just a message string).
- Tests covering: nudge-fire records its `id` to audit, multiple nudges in one call record all of them, `_guidance` response field still surfaces correctly.

**Acceptance.**
- A tool call that triggers two nudges produces an audit event with `nudges_fired.length === 2`, each with a stable `id`.
- The agent-visible `_guidance` response field is unchanged.
- Existing nudge tests continue to pass.

**References.** `src/server/tools/_tool.ts`, `src/server/nudges/registry.ts`, `src/server/nudges/rules/`, `src/server/audit/schema.ts`.

---

#### 1.3 — Deterministic sandbox reset (`reset_sandbox`)

**Problem.** `clear_target` (`src/server/tools/read/clear-target.ts:25`) only removes `target.json`. `set_flows_state` (`src/server/tools/deploy/set-flows-state.ts:19`) toggles runtime start/stop. `reset_runtime` (`src/server/tools/dangerous/reset-runtime.ts:34`) deploys `[]` (empty), is not seedable, and is gated behind dangerous-tier + a one-shot `prepare_dangerous_operation` token — friction the harness shouldn't have to repeat between tasks. Snapshot/staging/plan stores have no batch-clear.

**Changes.**
- New tool `src/server/tools/dangerous/reset-sandbox.ts` with input schema:
  ```ts
  {
    seed_flows?: FlowsJson | { snapshot_id: string }
    clear_staging: boolean
    clear_plan: boolean
    clear_audit: boolean
    clear_snapshots: boolean
    clear_session_state: boolean
  }
  ```
- Implementation calls `staged.clear()` (`staged-store.ts:70`), `clearPlan()` (`plan-record.ts:72`), `clearPreviewTracker(container)` (`deploy-without-preview.ts:26`), truncates `AUDIT_LOG_PATH` when requested, deploys `seed_flows` via `flowSource.save`.
- Register in `src/server/tools/toolsets.ts` `dangerous` toolset.
- Optional env-flag `HARNESS_MODE=true` that auto-bypasses the per-op token (the harness is trusted; the user already configured a sandbox).
- As a related task, add a `seed_flows` parameter to the existing `reset_runtime` tool (`src/server/tools/dangerous/reset-runtime.ts:5-12`) so it can also seed rather than only clearing to empty.
- Tests covering: full reset round-trip (seed → mutate → reset → verify), each clear-flag in isolation, HARNESS_MODE bypass.

**Acceptance.**
- A single `reset_sandbox` call with all clear-flags + a seed brings runtime + FlowOtter state to a known fixture in one round-trip.
- Existing dangerous-tier safety is preserved when `HARNESS_MODE=false`.
- `reset_runtime` with `seed_flows` deploys the supplied fixture instead of an empty array.

**References.** `src/server/tools/dangerous/reset-runtime.ts`, `src/server/tools/read/clear-target.ts`, `src/server/tools/deploy/set-flows-state.ts`, `src/toolkit/staging/staged-store.ts`, `src/toolkit/staging/plan-record.ts`, `src/server/nudges/rules/deploy-without-preview.ts`, `src/server/tools/toolsets.ts`.

---

#### 1.4 — `inject_msg` stimulus primitive

**Problem.** The Node-RED Admin API does not expose runtime message injection. Without it, behavioral testing is impossible — the harness cannot exert controlled stimulus to verify that flow logic does the right thing. FlowOtter's `get_recent_debug_messages` provides observation; the missing half is causation.

**Changes.**

Two components:

**(a) Companion Node-RED contrib module.** New package in this monorepo at `packages/node-red-contrib-flow-otter-injector/` (or a separate repo, see Open Questions). Registers an HTTP admin route `POST /flow-otter/inject` accepting `{ node_id: string, msg: unknown }`, looks up the target node via `RED.nodes.getNode(id)`, and calls `node.receive(msg)`. Returns 200 on success, 404 if node not found, 400 on malformed input. Tested against Node-RED 3.x and 4.x.

**(b) FlowOtter tool.** New tool `src/server/tools/deploy/inject-msg.ts` (tier=`deploy` since it touches the live runtime). Input schema:
```ts
{
  node_id: string
  msg: unknown
}
```
POSTs through the existing `NodeRedClient.request()` helper. Returns `{ ok: true, injected_at: ISO8601 }` on success; structured error on failure. Tier-gated; not callable in read-only mode.

**Companion helper.** A second tool `await_debug` (or extend `get_recent_debug_messages` with `wait_for: { node_id, timeout_ms }`) that blocks until the next debug message matching a predicate arrives, with a bounded timeout. This closes the causation/observation loop for `{ input, target, expected, timeout }` tests.

**Integration test.** Against the docker-compose stack: deploy a simple inject→function→debug flow, call `inject_msg(node_id=function_id, msg={ payload: 42 })`, assert `get_recent_debug_messages` shows the transformed message within 500ms.

**Acceptance.**
- The contrib module installs cleanly in Node-RED 3.x and 4.x.
- An end-to-end test exercising inject→observe round-trip passes deterministically against the docker-compose stack.
- The tool surfaces in `tools/list` when write+deploy tiers are enabled.
- Failure modes (target node doesn't exist, runtime unreachable, contrib not installed) are reported as structured errors, not raw exceptions.

**References.** `src/adapters/nodered/client.ts:52-227`, `src/server/tools/toolsets.ts`, `src/server/tools/read/get-recent-debug-messages.ts`.

---

### Wave 2 — Verification harness

**Goal:** build the infrastructure that runs eval tasks against FlowOtter and grades the results. Lives in this repo at `evals/`.

**Dependency:** Wave 1 must be complete. The harness depends on audit provenance (`session_id` correlation), structured nudge events (grading signal), `reset_sandbox` (between-task hygiene), and `inject_msg` (behavioral grading).

#### 2.1 — Corpus task schema

**Spec.** Each task is a single YAML file at `evals/tasks/<NNNN>-<slug>.yml`:

```yaml
id: 0001-mqtt-passthrough
category: simple-pipeline   # one of: simple-pipeline, dashboard, fix-flow, refactor, fleet, isa-101
difficulty: 1               # 1-5
prompt: |
  Build a flow on a new tab named "Passthrough" that subscribes to MQTT topic
  "in/sensor" on the local broker, transforms each message by doubling the
  payload's `value` field, and publishes the result to "out/sensor".
seed:
  flows_fixture: fixtures/empty.json
  broker_topics_to_clear: ["in/sensor", "out/sensor"]
grader:
  mechanical_checks:
    - kind: validate_flow
      expect: passes
    - kind: deploy_succeeds
    - kind: behavioral
      stimulus:
        node: ${inject_node_id_or_via_inject_msg}
        msg: { topic: "in/sensor", payload: { value: 21 } }
      expect_debug:
        topic_contains: "out/sensor"
        payload_path: $.value
        equals: 42
        timeout_ms: 1000
    - kind: audit_assertion
      expect_tool_sequence_contains: ["preview_flow_diff", "deploy_staged_change"]
  judgment_rubric:
    - "The flow uses MQTT in and MQTT out nodes, not HTTP."
    - "The transformation is performed by a function node, not by overloading the MQTT nodes."
    - "Layout is left-to-right with no overlapping nodes."
budget:
  max_turns: 40
  max_tool_calls: 60
  timeout_seconds: 300
```

**Versioned in-repo.** Tasks evolve alongside FlowOtter. Treat corpus changes as breaking (corpus version bumps require eval re-baseline).

#### 2.2 — Sandbox orchestrator

**Spec.** Shell scripts at `evals/scripts/`:

- `up.sh <run_id>` — `docker compose -p eval-<run_id> -f deploy/docker-compose.yml up -d`, ports randomized via env override, returns `{ node_red_url, mqtt_broker_url }` JSON on stdout.
- `seed.sh <run_id> <fixture.json>` — POSTs the seed flows to `<node_red_url>/flows`, waits for healthy.
- `capture.sh <run_id>` — collects: final `/flows` JSON, full `audit.jsonl`, debug message buffer, `mosquitto_sub '#'` tail.
- `down.sh <run_id>` — `docker compose -p eval-<run_id> down -v`.

Each script idempotent and safe to re-run. Per-run state lives at `evals/runs/<run_id>/`.

#### 2.3 — Mechanical grader

**Spec.** A Node.js module at `evals/grader/mechanical.ts` (consistent with the FlowOtter codebase language). Reads `<task>.grader.mechanical_checks[]` and the captured run state; emits a structured score:

```ts
type CheckResult = { check_id: string; passed: boolean; evidence: string }
type MechanicalScore = {
  passed: boolean         // all checks passed
  total: number
  passed_count: number
  results: CheckResult[]
  tool_calls: number
  dead_ends: number       // consecutive identical failed tool calls
  duration_ms: number
}
```

Check kinds:
- `validate_flow` — re-runs FlowOtter's own `validate_flow` against the final state
- `deploy_succeeds` — verifies the staged change actually deployed (audit log has a successful `deploy_staged_change` event)
- `behavioral` — uses `inject_msg` + `get_recent_debug_messages` to verify stimulus/response
- `audit_assertion` — pattern-matches the audit log for required tool sequences

#### 2.4 — Judgment grader (deferred)

**Initial release omits LLM-as-judge.** Per the strategic frame, judgment grading is high-bias and high-cost. Wave 2 ships mechanical-only; Wave 5 considers whether judgment grading earned its keep.

When implemented, the judgment grader should use **claims-based scoring** (each rubric item evaluated independently, pass at coverage ≥ 0.75), not holistic scoring.

#### 2.5 — Result aggregator

**Spec.** A Node.js module at `evals/aggregator/index.ts`. Reads per-task scores from one run, aggregates by stratum (category) and overall, writes:

- `evals/runs/<run_id>/summary.json` — machine-readable
- `evals/runs/<run_id>/report.md` — human-readable, includes per-task pass/fail, tool-call counts, deltas vs. specified baseline run

#### 2.6 — Comparison reports

**Spec.** A `evals/scripts/compare.sh <run_id_a> <run_id_b>` that produces a side-by-side delta report:

- Pass-rate by stratum
- Per-task pass→fail and fail→pass transitions (high-signal regression / improvement)
- Tool-call count and dead-end deltas
- Audit-log nudge-firing deltas (did changes in nudges materially affect behavior?)

For statistical comparison, use **paired McNemar** for binary outcomes when both runs use the same task corpus + same consumer-model snapshot. Pre-register the comparison hypothesis to avoid post-hoc fishing.

---

### Wave 3 — Initial corpus + first eval run

**Goal:** establish the v1.0 corpus and complete the first full eval run end-to-end.

#### 3.1 — Corpus v1.0 (N=8)

Eight tasks, stratified across four categories (two per stratum):

- **simple-pipeline** — MQTT passthrough, MQTT-to-HTTP webhook
- **dashboard** — three-widget operator console, alarm-table + mode-banner composition
- **fix-flow** — broken wires, missing config node
- **refactor** — fold-to-subflow, extract-template

Each task: prompt + seed fixture + grader rubric, committed to `evals/tasks/`. Per stratum, one task should target a known FlowOtter strength (validators catch real bugs) and one a known weakness (the README's "what the agent still had to bring" cases).

Held-out **test set is deliberately deferred** until corpus reaches N≥20. With N=8 there is no statistical room for a train/test split; the entire corpus is "dev" for the first phase. Test-set discipline activates in Wave 5.

#### 3.2 — First baseline run

Execute the eval against FlowOtter@HEAD post-Wave-1-merge:

- Spin up eight sandbox sets via `up.sh` (parallel-safe via per-run project namespaces)
- For each task, spawn a runner (see "Runner architecture" section) that attempts the task with FlowOtter available
- Capture full state, mechanical-grade, aggregate

**Outputs.**
- `evals/runs/<timestamp>-baseline-v1.3.X/summary.json`
- `evals/runs/<timestamp>-baseline-v1.3.X/report.md`
- A `evals/BASELINE.md` document committed to the repo documenting the baseline pass-rate per stratum

#### 3.3 — Failure-mode taxonomy v1

From the baseline run, categorize every failure. Possible buckets (extend as observed):

- `schema-rejection-loop` — agent retries same malformed call
- `validator-rejection-loop` — agent doesn't read validator output
- `premature-deploy` — deploy without preview
- `layout-overflow` — off-canvas or overlapping output
- `broken-wires` — orphan or cross-tab wire
- `missing-config-node` — e.g., `mqtt-broker` not auto-created
- `methodology-skip` — agent skipped `plan_flow` for an in-scope task
- `nudge-ignored` — nudge fired, agent didn't course-correct

Each bucket becomes a candidate FlowOtter improvement target. Document at `evals/TAXONOMY.md`.

---

### Wave 4 — Elicitation coverage expansion

**Goal:** systematically expand MCP elicitation across FlowOtter's tool surface so that consequential operations have explicit user-side verification checkpoints. Today only `deploy_staged_change` uses elicitation; the wrapper at `src/server/elicitation/client.ts` is well-factored and ready for broader use.

**Dependency:** the Wave 2-3 harness exists so each elicitation addition can be verified to improve correctness without tanking time-to-completion.

#### 4.1 — Per-tool elicitation matrix (research)

Produce `docs/ELICITATION_MATRIX.md` cataloging every tool against:
- Should this tool elicit? (yes / conditional / no)
- Under what condition? (always / when destructive / when crossing tab boundaries / when violating naming contract / etc.)
- What schema does the elicitation present?
- What is the fallback when the client doesn't support elicitation? (refuse / require `force:true` / proceed with default)

Categorize tools by elicitation profile:
- **Pure observation** (no elicitation) — `health_check`, `get_flow`, `list_flows`, `validate_flow`, `render_flow_svg`, etc.
- **Local stage with conditional elicitation** — `remove_node` (elicit when removing wired nodes), `update_node` (elicit when changing wire-affecting fields), etc.
- **Re-scope** (always elicit) — `set_target`, `clear_target`
- **Deploy/runtime** (always elicit) — `deploy_staged_change` (already done), `rollback_last_change`, `set_flows_state`, `inject_msg` (after Wave 1)
- **Dangerous tier** (elicit in addition to token pattern) — all `dangerous` toolset members
- **Authoring with judgment** (elicit) — `instantiate_template` (cascading effects), `create_subflow_definition` from existing nodes (refactor), plan-deviation detected by nudge system

Inform the matrix with external research: read other Anthropic-published MCP server implementations for elicitation patterns; survey client-side rendering (how Claude Code, Cursor, Continue surface elicitation UI) to ensure FlowOtter's elicitation messages compose well across clients.

#### 4.2 — Implementation pass

Implement elicitation across the matrix in a single coherent pass with a unified style guide:
- Consistent message phrasing (action verb + object + consequence)
- Consistent field shapes (boolean confirm/cancel default false; string for typed acknowledgment when high-stakes)
- Consistent fallback (clients without elicitation must pass `force:true` to proceed)
- Consistent audit trail (elicitation outcome recorded as a structured field on the audit event — extend `AuditEventSchema` with `elicitation: { action: 'accept'|'decline'|'cancel'|'unsupported'|'forced'; fields?: object }`)

Tests per site: elicitation accept path, decline path, cancel path, unsupported path, forced-bypass path, audit-log assertion that the elicitation outcome was recorded.

#### 4.3 — Eval-loop verification

Re-run the corpus from Wave 3 against the post-Wave-4 build. Use the comparison report:
- Did task pass-rate improve, hold, or regress?
- Did average time-to-completion increase? By how much? Acceptable threshold: < 20% increase per task
- Did failure modes shift? In particular: did `premature-deploy` and `wrong-target` failure modes drop?

Commit the comparison report to `evals/runs/`. If the data shows regression beyond the acceptable threshold, treat that as a signal that the elicitation site is over-eager — refine the trigger condition rather than the schema.

---

### Wave 5 — Operationalization

**Goal:** make eval runs a routine part of the release process.

#### 5.1 — Per-release eval gate

Document in `CONTRIBUTING.md`: before tagging a release, run the eval against the tag candidate. Commit the eval report alongside the release notes. A release is not blocked by score drops but is *required to disclose* them.

#### 5.2 — Corpus expansion to N≥20

Grow the corpus from N=8 to N=20+, maintaining stratum balance. Activate train/test split at N=20: 60% dev / 40% test, test set sealed and only opened on declared release candidates. Budget peeks (5 over the corpus lifetime); track in `evals/TEST_SET_LOG.md`.

#### 5.3 — Co-evolution discipline (model version tracking)

Add `consumer_model_version` and `consumer_model_snapshot_id` to every eval run record. When the primary consumer model updates, perform a **bridge run** before continuing iteration:
- Run the previous FlowOtter version against the new consumer model
- Compare against the previous FlowOtter × previous consumer model baseline
- If aggregate movement > 10%, recalibrate (re-baseline) before treating any subsequent FlowOtter delta as signal

Document the bridge-run protocol in `evals/CO_EVOLUTION.md`.

#### 5.4 — Curriculum / failure-mode-driven corpus growth

Use the taxonomy from Wave 3.3 to generate corpus expansions targeting under-represented failure modes. Each new task should be:
- Authored by a human contributor (not synthetic) — synthetic tasks risk corpus contamination
- Annotated with the failure mode it targets
- Added to **dev set only**, never directly to test set

---

## Runner architecture

The harness must invoke an autonomous agent to attempt each task. Three viable runner architectures, with tradeoffs:

### Option A — Interactive runner (recommended default for solo maintainers)

The runner is an interactive MCP-client session (e.g., Claude Code). Tasks are dispatched as subagents (Claude Code's `Agent` tool, or equivalent in other clients) from inside the session.

**Pros.**
- No API spend (consumer-side subscriptions cover interactive use)
- Subagents inherit MCP server registrations from the parent — no separate FlowOtter wiring
- Parallel execution via subagent fan-out
- Transcript surfaces as the subagent's tool-call log + return value
- Trivial setup; no SDK plumbing

**Cons.**
- Subagent isolation is softer than fresh-process isolation; parent context can subtly influence subagents
- Parallel concurrency is capped by the client's limits, not host CPU
- Full tool-call transcript may be partial in the parent's view — the harness must rely on FlowOtter's audit log (which is why audit-provenance in Wave 1.1 is load-bearing)

**Architecture.** A slash command or natural-language entry point that triggers the host model to spawn N parallel subagents, each given one task prompt and access to FlowOtter via inherited MCP. A grader subagent (or mechanical-only Bash) processes each subagent's final state + audit log.

### Option B — Headless runner (Anthropic SDK / `claude -p` / OpenAI SDK / etc.)

The runner is a headless agent invocation via a model provider's SDK. Tasks dispatched as fresh processes per run, with FlowOtter wired as the only MCP server in each process.

**Pros.**
- Fresh-process isolation guarantees no parent-state leakage
- Easier statistical rigor (k=3 replications per task, fully independent)
- Portable across model providers (Anthropic, OpenAI, Google, local)

**Cons.**
- API spend per run (significant at scale)
- Per-process MCP wiring overhead
- Headless agent state isolation requires care (`HOME=<tmpdir>` plus curated minimal client config)
- For Claude specifically, `claude -p` is not covered by Pro/Max subscriptions

**Architecture.** A Python harness using the chosen SDK. Spawns N parallel processes, each receiving one task prompt. Captures stdout/stderr including stream-json tool-call traces. Aggregates via mechanical grader.

### Option C — CI runner

Same as Option B but executed in CI (GitHub Actions, etc.) on every release-candidate tag.

**Pros.**
- Automated, no maintainer attention needed per run
- Public eval results possible if results are committed

**Cons.**
- CI minutes cost
- API key management in CI
- Eval runs become slow CI gates; not appropriate per-PR

**Status.** [`NON_GOALS.md`](NON_GOALS.md) currently lists "GitHub Actions / hosted CI" as out of scope for v1. This roadmap does not change that; Option C is a future consideration once the harness is proven.

### Choosing per project

The harness should support both Option A and Option B via a thin runner abstraction. Concrete contributors will pick based on their cost constraints and isolation needs.

---

## Acceptance criteria for the program as a whole

The program is complete when:

1. Every FlowOtter release tag (`v1.x.y`) has an accompanying eval report committed to `evals/runs/`.
2. Corpus is N ≥ 20 with maintained train/test split.
3. The bridge-run protocol has been exercised at least once for a consumer-model upgrade.
4. At least three failure modes in the v1 taxonomy have been closed (i.e., FlowOtter changes motivated by eval data demonstrably reduced their frequency).
5. Elicitation coverage matches the matrix from Wave 4.1.
6. `evals/README.md` documents how a new contributor runs the eval against a local FlowOtter build.

---

## Non-goals for this program

- **A leaderboard or public benchmark.** This eval is internal to FlowOtter's release process, not a competition.
- **A general-purpose MCP eval framework.** Tooling is purpose-built for FlowOtter; abstractions for other MCP servers can be extracted later if useful.
- **Per-PR eval gating.** Eval runs are per-release, not per-commit. CI integration is out of scope (see Option C above).
- **Cross-model leaderboards.** The eval measures FlowOtter quality, not which consumer model is best at using FlowOtter.
- **Replacing human review.** Eval reports inform release decisions; they do not auto-block or auto-merge.
- **Knowledge-layer expansion.** This roadmap is deliberately silent on adding catalog entries, methodology pages, or generic nudges. Those depreciate as consumer models improve; the eval loop may surface specific knowledge gaps worth closing, but blanket expansion is not in scope.

---

## Open questions

These are flagged for contributor input. Each open question is a candidate GitHub issue:

1. **Contrib module placement.** Should `node-red-contrib-flow-otter-injector` (Wave 1.4) live in this monorepo or a separate repository? Monorepo simplifies versioning but couples the Node-RED contrib release cadence to FlowOtter's. Separate repo aligns with Node-RED ecosystem conventions.
2. **Judgment grader timing.** Wave 2.4 defers LLM-as-judge to a Wave 5 consideration. Some failure modes (subjective quality of operator dashboards, ISA-101 judgment beyond lints) may require it sooner. Trigger conditions for adding it earlier?
3. **Statistical rigor at N=8.** McNemar requires ~8-10 discordant pairs to clear p<0.05. At N=8 with binary outcomes, the eval is descriptive not inferential. Should the program block on reaching N=20 before claiming improvements, or accept descriptive deltas as actionable in the interim?
4. **Failure-mode handling.** When the eval surfaces a failure mode that's specifically a knowledge-layer gap (e.g., agent doesn't know that `link call` requires `linkType: "dynamic"`), is the right response to add validation, add a nudge, expand `get_authoring_guide`, or something else? The roadmap's strategic frame says minimize knowledge-layer; the eval data may push the other way.
5. **Corpus IP / contributions.** Should the corpus accept community-contributed tasks under what terms? How is task originality verified to prevent contamination (a contributor submits a task they've already tuned FlowOtter against)?

---

## How to contribute to this roadmap

- **Comments / suggestions:** open a GitHub issue with prefix `[ROADMAP]`.
- **Wave-specific implementation work:** issues will be filed per wave with detail extracted from this document. Pick up an issue and submit a PR; this roadmap is the spec.
- **Open questions:** comment on this PR (if reviewing this document) or open an issue against the question.

---

## Document changelog

| Date | Change |
|------|--------|
| 2026-05-26 | Initial draft. Wave structure, strategic frame, runner options, acceptance criteria. |

---

## Companion references

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — toolkit/server layering, write pipeline, dangerous pipeline
- [`NON_GOALS.md`](NON_GOALS.md) — items explicitly out of scope for FlowOtter v1.x
- [`REDESIGN_PLAN.md`](REDESIGN_PLAN.md) — v1.3.0 design rationale
- [`SECURITY.md`](SECURITY.md) — threat model, redaction, tier gates
- [`AGENT_QUICKSTART.md`](AGENT_QUICKSTART.md) — how an agent drives FlowOtter
- [`TOOL_REFERENCE.md`](TOOL_REFERENCE.md) — per-tool signatures and examples
