# Changelog

## 1.4.0 (unreleased)

### PHASE1-EXIT fixes

- **`scripts/check-tool-coverage.mjs`** (36759aa): tool coverage no longer counts phantom tools from any `name:'...'` literal in `toolsets.ts`; the scanner now counts only files exporting an MCP Tool definition, and real coverage closes the gate: `get_authoring_guide` unit+integration plus toolset-discovery integration coverage for `plan_flow` / `enable_toolset` / `list_available_toolsets` (**66 tools, 0 missing**).
- **`SERVER_INSTRUCTIONS` / `review_my_flow`** (cc36809): dropped unshipped Phase-2 claims (`stage_changes` batching, `validate_flow` layout scores) that caused Unknown-tool failures and wasted invocation budget; instructions now describe the real staged-change lifecycle (pending-stage guard, `get_staged_change` `staged_hash`, `preview_flow_diff` before deploy) and actual `validate_flow` diagnostics, with pins updated and all D-5 numeric layout tokens kept.
- **Compile identity fallback** (6f70281): fast-check found a cross-tab move losing a node's materialized id when the same authoring key existed inside a subflow definition; the global `kind:key` fallback is now scoped by global/tab/subflow, exact container matching stays unchanged so previously compiled specs keep their ids, and deterministic regression tests encode the counterexample.
- **Staged-change lifecycle nudge** — live S5-session evidence (2/2 runs): after staging and reading the preview, agents immediately re-staged the refinement and hit the pending-stage guard, burning a budgeted failed call — the guard's message teaches recovery one invocation too late. Every successful author-tier response whose `staged_hash` matches the live pending stage now carries a one-line `staged-change-lifecycle` nudge (discard-to-iterate / deploy-to-commit). Output-only: staged bytes/hashes pinned byte-identical with the nudge active; `eval:canary` + `eval:s5` green.
- **Node-id tolerance on `node_key` inputs** — live S5-session evidence: an agent passed a Node-RED node id where `node_key` (authoring key) is expected and got a bare not-found, costing a budgeted invocation (audit ledger e3#2's node half; WSB-6 owned the tab half). New shared resolver (`src/server/tools/author/_node-key-resolution.ts`): key match always wins; on key miss an exact SAME-tab node id resolves to its authoring key and fires a `node-key-vocabulary` nudge teaching the vocabulary; other-tab ids are refused naming the actual tab; id-looking misses say the value looks like a node id (`get_flow` shows both `id` and `_authoringKey`). Wired into `move_node`, `update_node`, `remove_node`, `wire_nodes`, `set_wires`, `add_debug_node` source, `add_node` source, and `add_group.node_keys`.

### EVAL-6 — Safety-spine canary + per-batch verification protocol + AUDIT-RERUN anchors (`npm run eval:canary`)

- New **`npm run eval:canary`** (`scripts/eval/run-canary.mjs`): the per-fix-batch safety-spine gate, run after EVERY fix batch (fix plan §1 "Safety spine: zero regressions"). Four legs through the EVAL-1 driver against the sterile stack, each from a freshly seeded committed baseline: **S4 main** (`scripts/eval/steps/s4-steps.json` — stage → `mutates:true` out-of-band Admin-API mutation → `deploy_staged_change` **refuses on drift** with `expected_hash`/`actual_hash` on the wire even though consent was given via `confirm:true` → `rollback_last_change` → **byte-identical restore** proven by re-hashing the live runtime against rollback's `restored_hash` via the new `scripts/eval/compare-runtime-hash.mjs` (imports the shared `compare.mjs` — no duplicate comparator) → elicitation **decline** aborts a fresh deploy with the staging slot intact → dangerous tools absent without their env flag); **S4 read-only** (`scripts/eval/steps/s4-readonly-steps.json`, pins `READ_ONLY_MODE=true` in its own steps `env` — reads work, `health_check` reports `read_only_mode: true`, author/deploy/dangerous tiers unregistered); **S1 twice** (`scripts/eval/steps/s1-steps.json` — the README Tab-1 author loop: all ten missing common node types added by `add_node` plus the baseline inject, `wire_nodes`/`set_wires` fan-out/`set_links` dynamic link-call pairing/`add_group`/`add_comment`, one consented deploy per op, budget-recorded at **30 MCP calls / 15 confirmations / 0 failed**), with the runner asserting the two runs deploy **byte-identical flows** (`canonicalFlowsHash` + wiring fingerprint — the README idempotency claim, stable ids included) and that every S4 leg leaves the runtime byte-identical to its seeded baseline. **These are pinned credits: the canary passes at HEAD (twice consecutively, verified) because the audit found the spine held — any future failure blocks everything else.** The SDK elicitation-decline leg is fully automated (the driver's `ElicitRequestSchema` handler answers per-step directives; verified against `@modelcontextprotocol/sdk` 1.29.0).
- Steps-file structure + exact budgets pinned by `tests/unit/scripts/eval/s4-steps.test.ts` / `s1-steps.test.ts` (28 pins — loosening a drill or a budget is loud; s1's embedded compile-derived ids are recomputed from authoring keys via `generateNodeId`, so the id-derivation contract cannot drift silently); the whole gate runs as a standing integration test (`tests/integration/eval-canary.test.ts`, counters asserted exactly on the committed budgets).
- **`scripts/eval/replay/AUDIT-RERUN.md`** — the FULLY FIXED re-run protocol: the fix plan §1 mechanical anchors table (friction from the budget account, not judge sympathy), the gate-runner status matrix, the **zero-coordinate disqualification rule** (e1-phase2 + all S6 leg-B specs run under the driver's `layout_computed` anti-gaming lint — a hand-placed spec disqualifies the run, no judge discretion), the **binding live-session rule** for S5/S7-class gates (scripted run = standing regression; live unscripted run = ergonomic proof; both required, recorded in run files), and the per-batch canary + twice-consecutive + committed-numbers-not-author's-head protocol. `docs/EVALUATION.md` gains "The canary gate" (normative protocol) and points S1/S4 and the iteration protocol at `eval:canary`.

### EVAL-2 — The S5 gate: ≤6-total-invocation visual loop + live-editor fidelity (`npm run eval:s5`, F1/e3)

- New **`npm run eval:s5`** (`scripts/eval/run-s5.mjs`): the committed, falsifiable form of the re-specified S5 gate — see-judge-adjust in **≤6 TOTAL invocations (MCP + Read/exec), `max_failed: 0`**, rendering STAGED state, plus ±2px live-editor fidelity of the deployed result. Two legs: (1) the ONE canonical steps file `scripts/eval/steps/s5-steps.json` through the EVAL-1 driver — unbudgeted setup (seed a mis-placed node, deploy w/ 1 confirmation) → **budgeted loop `{max_total_invocations: 6, max_failed: 0}`**: `move_node` → exec-Read `after_png` → `discard_staged_change` → `move_node` adjust → exec-Read `after_png` (5 invocations, one spare; achievable only because REND-8 puts `after_png` on stage outputs — an explicit-render loop with the mandatory discard costs 7) → unbudgeted verify (deploy w/ 1 confirmation); (2) editor capture over the shared CDP stack (`scripts/eval/cdp.mjs`) compared against `renderGeometry` with REND-7's single shared ±2px comparator (`scripts/eval/fidelity.mjs`, fixture-freshness guard included — no duplicate comparator). Exit 0 pass / 1 gate fail / 2 abort; prior flows restored; per-run temp state under a fresh `ENVIRONMENT_NAME`. First two consecutive live runs on Node-RED 4.1.11: **PASS, loop = 5/6 total invocations, fidelity zero deltas**.
- **Driver:** `exec` steps now interpolate embedded `$PREV` tokens (`od -An -tx1 -N 8 "$PREV.render.tabs.0.after_png"` — the S5 Read) with the same hard poisoning rules as tool-arg substitution, plus an abort on non-scalar resolutions (a `null` `after_png` from a missing rasterizer can never silently splice into a shell command). Token segments are `[A-Za-z0-9_]`; interpolation happens before the step is counted or run.
- **Pins:** `tests/unit/scripts/eval/s5-steps.test.ts` locks the steps-file structure and its budget block (the audit-F1/e3 regression — loosening the gate is loud); `tests/integration/eval-s5.test.ts` runs the driver leg unconditionally against the compose stack (loop counters pinned at 3 MCP + 2 exec = 5, 1+1 confirmations, 0 force/OOB) and the full gate env-gated behind `FLOWOTTER_LIVE_EDITOR=true`. `docs/EVALUATION.md` gains "The S5 gate" section (gate declaration = twice-consecutive scripted passes + one live unscripted session, per the ratified plan).

### D-5 — Layout conventions taught in-band, with numbers (R6, F4)

- **`SERVER_INSTRUCTIONS` rewritten** (sole owner per the fix plan's triple-contention resolution; 1972/2000 chars, ceiling pinned by `tests/unit/server/instructions.test.ts`). New `LAYOUT CONVENTIONS` line carries the numbers an agent previously had to invent: **20px grid; stages left-to-right at a 140-220px column pitch; error lane ≥120px BELOW the happy path (the shared `LANE_GAP` constant); switch port 0 (affirmative) on top; tab ≤1420px wide (visible viewport ≈ 1920 window − 180 palette − 320 sidebar); minimize crossings, no backward wires**. Also lands the two handed-over mentions: REND-5's `render_flow_png` ("returns `png_path` — Read the file", `against:'staged'`) and WSB-5's `stage_changes` phase-3 sentence. Funded by the named trims (SPECIALISTS examples, CREDENTIALS/DASHBOARDS compression — open question #3 resolved as specced). The D-5 draft deliberately forward-referenced `stage_changes` and layout scores (Phase-2 capability) to spend the 2000-char budget once; PHASE1-EXIT superseded that call — unshipped-capability claims cost real agents Unknown-tool failures — and removed them (see PHASE1-EXIT fixes); the sentences return with WSB-5/D-3 in v1.5.0.
- **New catalog category `layout_conventions`** (`get_authoring_guide`): EIGHT entries 1:1 with the 2026-06-10 audit criteria (lifecycle left-to-right, stages grouped, stage headers, error lane below, affirmative output on top, minimal crossings, no backward wires, grid-aligned within viewport), each stating its numeric convention and naming its **frozen scored lint rule id** (`layout-stage-order`, `layout-group-overlap`, `layout-header-presence`, `layout-error-lane-below`, `layout-affirmative-on-top`, `layout-wire-crossings`, `layout-backward-wires`, `layout-viewport-overflow` — fix-plan D-1/D-2 names; the rules register with the v1.5.0 layout lint). `tests/unit/catalog/layout-conventions.test.ts` pins the eight frozen pairs now and carries a **bidirectional completeness suite (catalog ↔ registered rule ids) that auto-activates when `src/toolkit/lint/layout-lint.ts` lands**, with an always-on guard test recording the dormancy until then. The methodology `layout`/`review` phases reference the criteria and the PNG channel.
- **Prompt recipes**: `new_flow` step 5 now teaches the same numeric conventions; `review_my_flow` gains a layout-scores step (`get_authoring_guide(['layout_conventions'])` + report validate_flow's per-rule layout scores when present). Convention tokens are pinned in both the instructions and prompt test suites ('20px', '140-220', 'BELOW', 'port 0', '1420', '120').

### REND-7 — Renderer-fidelity regression harness (R3 acceptance, F9)

- New **`npm run fidelity:editor`** (`scripts/editor-fidelity-check.mjs`, on the shared CDP stack `scripts/eval/cdp.mjs` — no playwright/puppeteer): deploys the canonical e1 audit fixture to the local sterile stack, captures per-node geometry + port-box centers from the real headless editor, and compares against `renderGeometry` (frozen contract #1). **First live run on Node-RED 4.1.11 passes exactly**: 20 entries, 80 corners, 22 port centers, zero deltas. Exit 0 pass / 1 fidelity fail / 2 abort; prior flows restored after capture. Also runs as an integration test env-gated behind **`FLOWOTTER_LIVE_EDITOR=true`** (`tests/integration/editor-fidelity.test.ts`) so the standard suite stays green without Chrome. Layer A (always-on CI) remains the REND-3 assertion suite + re-bless protocol and the REND-2 editor-truth pins.
- **The single ±2px comparator ships as a shared library** (`scripts/eval/fidelity.mjs` + `.d.mts`): per-corner + per-port-center (the stricter basis — width drift with an unchanged center fails), junction entries paired **by coordinates** (their editor `<g>` has no id attribute), `offset` hook for renderGeometry's negative-extent translate. Consumed by `fidelity:editor` now and EVAL-2's `eval:s5` fidelity leg next — duplicate comparators are banned by the fix plan. Includes a **fixture-freshness guard** (`checkFixtureFreshness`: live editor version vs the committed `tests/fixtures/editor-metrics/` captures — exact / same-minor patch drift / the recorded 4.0-equals-4.1 assumption; anything else aborts the run) and the editor-capture half (`pageEditorReady`/`pageGeometryDump`/`normalizeEditorDump`/`captureEditorGeometry`, active-workspace-scoped).
- **Finding (recorded, basis-shaping):** the editor _derives_ group rects from member bboxes + label padding on load and ignores stored group `x/y/w/h` (e1's compile-autofit boxes diverge up to 46px while every node/comment/port matches exactly) — so the live basis is per-node geometry + ports, groups excluded by default (`--include-groups` to inspect; `EDITOR_DERIVED_KINDS` in the library). Group correctness stays pinned in CI by REND-3 containment + REND-2 autofit pins; the autofit-vs-editor padding gap is the group-geometry owner's (D-1) call. `docs/EVALUATION.md` gains the "Renderer-fidelity harness" section: S5 prerequisite + per-Node-RED-minor checklist.

### REND-8 — Before/after render paths on stage outputs (D5 second half, F1)

- Every successful stage now emits a **`render` block** on the tool output: `{rasterizer_available, tabs:[{tab_id, before_svg, after_svg, before_png, after_png}]}` — before/after preview file paths for every tab the stage touched (prior runtime vs staged flows). SVG always; PNG only when the optional `@resvg/resvg-js` rasterizer imports — PNG absence is LOUD (`*_png: null` + `rasterizer_available: false`), never a silent SVG substitution. A side is null when the tab only exists on the other side (tab created/removed); changes outside any tab canvas (config nodes, subflow internals) yield an empty `tabs` list. This lands the audit's honest ≤6-invocation S5 loop: `move_node` → Read `after_png` costs two invocations, no explicit render call.
- Implemented **inside `compileValidateAndStage`** (`src/server/tools/author/_stage-render.ts`, executed at the REND-8 seam strictly AFTER `staging.write`) so per-op author tools and the future `stage_changes` batch share one enrichment point. **Output-only by construction**: staged bytes, `staged_hash`, `based_on_snapshot_hash`, the single-slot guard and drift refusal are untouched — pinned test-first by `stage-render-hash-invariance.test.ts` against LITERAL hashes captured at pre-REND-8 HEAD, and re-pinned under failure injection (renderer throws → stage succeeds with `render: null`) and rasterizer absence. Render failures never fail a stage.
- Files land under `RENDER_DIR` as `stage-<tab>-before/after.svg/.png` (atomic write, overwritten per stage). A `stage-render.json` sidecar keyed by `staged_hash` lets **`get_staged_change`** re-surface the same `render` block for exactly the pending stage (hash mismatch / missing sidecar ⇒ `render: null`) — an agent that lost its context can recover the preview paths without re-staging.
- All 24 staging author tools emit the new field (their `OutputSchema`s document it); `docs/ARCHITECTURE.md` Write Pipeline and `docs/TOOL_REFERENCE.md` (Author Tools intro + `get_staged_change`) describe the contract.

### REND-5 — NEW tool `render_flow_png` (F1, D5, R3)

- New read-tier tool **`render_flow_png`** (`analyze` toolset): renders one tab to a PNG **file on disk** and returns `{rev, tab_id, against, staged_hash, based_on_snapshot_hash, png_path, width_px, height_px, geometry?}` — closing audit F1 (the agent had no image channel; `render_flow_svg` XML is invisible to Claude Code, which CAN read PNG files from disk). Mirrors REND-4's `against:'staged'|'runtime'` contract exactly, including the `staging/no-staged-change` empty-slot diagnostic. `include_geometry: true` emits the `renderGeometry` array (frozen contract #1) byte-for-byte; `scale` (≤4) zooms; `output_path` (absolute, home/tmp-contained) overrides the default `RENDER_DIR/render-<tab_id>-<against>.png` (atomic tmp+rename write). New `RENDER_DIR` config knob, env-scoped under `~/.flow-otter/<env>/renders` on `set_target` like the other state dirs.
- Rasterization (`src/toolkit/render/png.ts`) uses **`@resvg/resvg-js`** as a new `optionalDependency` (exact-pinned 2.6.2 for byte-stable output) behind a dynamic import. When it is not loadable the tool **HARD-FAILS with `RasterizerUnavailableError`** carrying an install hint — never a silent SVG substitution (pinned by mocked-import tests). `health_check` gains **`rasterizer_available: boolean`** so agents can probe the PNG channel before relying on it.
- Text renders exclusively from a **bundled OFL-1.1 Inter Regular latin subset** (~81 KB TTF, base64-embedded in the generated `src/toolkit/render/fonts/inter-regular.ts`; provenance + regeneration pipeline in `scripts/generate-font-module.mjs`) — system fonts are never loaded, so PNGs are byte-stable across machines: the e1 audit fixture render is pinned as an unconditional golden PNG. The OFL license text ships inside the module (and dist/), alongside as `fonts/OFL-Inter.txt`, and in the new repo `NOTICE`. Found and routed around: resvg-js 2.6.2 silently ignores its (then-unreleased) `fontBuffers` option **and the whole options struct with it** — the supported `fontFiles` API is used via a content-addressed temp extraction of the embedded font.
- Transport: tools may now declare an optional **`buildContent`** hook (success path only); the stdio CallTool handler routes through `buildSuccessContent`, whose default path is pinned **byte-identical** to the legacy single pretty-JSON text block. `render_flow_png` uses it for `return_image: true` — an opt-in inline `image/png` content block appended after the JSON text block (default off: Claude Code reads `png_path` from disk and base64 blocks are dead weight there).

### REND-4 — `against:'staged'|'runtime'` on render_flow_svg (F7)

- `render_flow_svg` gains an `against` input (`'staged' | 'runtime'`, default `'runtime'` for back-compat — pinned byte-identical to an explicit runtime render). `against:'staged'` renders the pending staged change from the staging slot, closing audit F7: the prescribed pre-deploy visual review previously could NOT show the change under review because the tool always read the runtime. An empty staging slot fails with `ValidationFailedError` carrying a `staging/no-staged-change` diagnostic.
- Output gains `against`, snake_case `staged_hash`, and nullable `based_on_snapshot_hash` (both hashes null for runtime renders); for staged renders `rev` is the runtime rev the stage was computed against (= `get_staged_change`'s `based_on_rev`). REND-5 mirrors the same contract on `render_flow_png`.
- Prompt-recipe truth edits: `new_flow`, `build_operator_dashboard`, and `refactor_to_subflow` now direct the pre-deploy render at `against:'staged'`; `explain_my_flow` states explicitly that the runtime default is correct for explaining deployed flows. `docs/TOOL_REFERENCE.md` documents the parameter.

### REND-3 — Renderer geometry correctness (F2, F3, F6, e2#11, e1#9 render-side)

- The SVG renderer (`src/toolkit/render/svg.ts`) now draws **editor-true geometry**: node and comment `x`/`y` are treated as CENTER anchors (the editor convention — was top-left, audit F2; groups stay top-left, their flows.json `x/y/w/h` is a bbox); heights come from `nodeDimensionsFor` (multi-output nodes are `outputs·15` tall, link `l:false` pills 30×30); input ports render only when the type has inputs, output ports sit at the editor's per-port-count anchors (13px pitch, centered on the right edge) via the REND-2 `GeometryProvider`.
- **Output-port counts read top-level `outputs`/`rules`** via `getOutputPortCount(n.type, n)` — the phantom `passthrough` read that collapsed every switch to one port (audit F3) is dead; subflow instances take port counts from the definition's `in`/`out` arrays.
- **Junctions render as r=5 waypoint circles** centered on (x, y) and participate in the wire walk via `wires[0]` (was: full-size labeled grey boxes with their outgoing wires silently dropped — audit F6/e2#11).
- **Config nodes never render**: nodes referenced from another node's scalar string props (excluding `wires`/`links`/`scope`/`g`/`z`/`d`/`id`; self-references exempt so adopted-flow `_authoringKey` stamps don't misfire) are excluded as config-by-reference, with `isConfigNode`/non-regular shape checks as belt-and-braces — renderer-side workaround for stamped canvas fields (audit e1#9); WSB-8 owns the root cause.
- **Whole-body translate**: negative extents (center-anchored nodes near the origin, port overhang included) shift the entire drawing into view instead of clipping; the translate is applied arithmetically so SVG attribute coordinates stay equal to geometry coordinates.
- New export **`renderGeometry(flows, tabId)`** (fix-plan frozen contract #1, re-exported from the toolkit index): per-canvas-object `{id, kind, x, y, w, h, ports[]}` (center-convention, post-translate, flows order) — the single geometry source for the REND-7 editor-fidelity comparator, EVAL-4 blind packs, and `render_flow_png include_geometry` (REND-5).
- All 5 blessed SVG snapshots re-blessed **under the re-bless protocol** (risk register #3), now documented in the `svg.test.ts` header: snapshots only change alongside assertion tests naming the geometry. The named assertions (a)–(f) survive any re-bless: (a) the canonical-e1 switch renders exactly 2 output ports at editor anchors, (b) no `<rect>` for the e1 mqtt-broker, (c) junction circle + outgoing wire path, (d) e1 group containment (all 14 members inside their group bboxes), (e) node at (0,0) fully visible with no negative coordinates, (f) every e1 wire endpoint equals a port coordinate. Integration pin updated: `render_flow_svg` output is asserted center-anchored against the seeded fixture.

### REND-2 — Editor-true node dimension model + GeometryProvider + compile auto-fit consumer (F11, F9)

- `src/toolkit/render/metrics.ts` now computes **editor-true node dimensions**: `nodeDimensionsFor(label, {hasIcon, inputs, outputs, hasButton, hideLabel})` replicates the Node-RED 4.1 editor exactly — `w = max(100, 20·ceil((labelPx@14px + 50 + (inputs>0 ? 7 : 0))/20))`, `h = max(30, outputs·15)`, link `l:false` pills 30×30. Minimum width is 100 (was 80), the fictitious 240px cap is removed (a 40-char label is 340px wide, as in the editor), and the glyph table moves from Adobe Helvetica AFM @12px to **Helvetica Neue regular advances @14px** (the editor's offscreen measurement span resolves to the regular face — the italic style applies only to the SVG canvas; verified live over CDP). The model reproduces every node, comment and link-pill dimension in the REND-1 4.1.11 fixture **exactly**, including the audit's named F11 cases: `'Parse reading'` → 160 (was 107), `'Debounce repeat alarms'` → 220 (was 163). Pinned table-driven in `tests/unit/toolkit/render/metrics-editor-truth.test.ts` (exact equality, subsuming the fix plan's ±2px bar; plus monotonic/≥100/mod-20/deterministic properties).
- New **`GeometryProvider`** (fix-plan frozen contract #2) exported from `metrics.ts`: `editorGeometryProvider` bundles `nodeDimensionsFor` + `outputPortAnchors` + `inputPortAnchor` under the pinned profile id `nodered-4.1` — the single geometry source for the renderer (REND-3), layout lint (D-1), placement (D-4) and the layout engine (LAYO-4). Port anchors reproduce the fixture's per-port-count table (1–4 outputs, 13px pitch, 5px edge overhang) and every captured DOM port box. Compile/auto-fit pins this one profile permanently regardless of target runtime (`compile()` stays pure); REND-1 proved 5.0.0 dimension-identical, so no version-keyed profile is needed.
- Compile's **group auto-fit** consumes the editor-true model (was: hardcoded `(label, false, 1)` widths, fixed 30px heights, 160px comment default): member widths honor per-type input/output counts (`getInputPortCount` joins `getOutputPortCount` in `authoring/types.ts`), multi-output members contribute `outputs·15` heights, label-hidden link members are 30×30, and size-less comments measure like the editor (label-derived width, min via the same formula). **Compile output changes ONLY for auto-fit-path groups** — explicit geometry is preserved verbatim, pinned test-first by a decompile→compile **byte-identity regression on the canonical e1 audit fixture** including `_authoringKey` ids (`tests/unit/toolkit/authoring/e1-byte-identity.test.ts`, verified green at HEAD before the model change; fixture committed verbatim at `tests/fixtures/audit-2026-06-10/e1-flows.json`). Auto-fit boxes for geometry-less groups are deliberately re-blessed with exact pins + derivations in `group-autofit.test.ts` (review note inline).
- `nodeWidthFor` stays as a thin deprecated wrapper over `nodeDimensionsFor` during the migration; the SVG renderer call site now uses editor-true widths (4 blessed snapshots mechanically re-blessed — anchor/port/height correctness and the formal re-bless protocol are REND-3).

### REND-1 — Editor ground-truth metrics capture (resolves DESIGN.md open question 3)

- New committed fixtures `tests/fixtures/editor-metrics/nodered-4.1.11.json` and `nodered-5.0.0.json`: one-time captures of the REAL Node-RED editor's geometry for the new calibration flow (`tests/fixtures/render/calibration-flow.json` — 0–40-char label ladder, inject/debug buttons, switch with 1/2/4 rules, link `l:true/false`, catch/status/complete, comments, a wired junction, a 2-node group). Each records the editor's `RED.nodes` model geometry (`{type, name, x, y, w, h, outputs, inputs}`), junction/comment/group DOM bboxes, label `getComputedStyle`, and per-port-count output-port offsets. This is the ground truth REND-2's editor-true `nodeDimensionsFor` is built on.
- **Empirical answer to DESIGN.md open question 3:** Node-RED 5.0.0's node-appearance rework changed NO dimension-bearing geometry vs 4.1.11 — widths (min 100, mod-20, no 240 cap; 40-char label = 340px), heights (`max(30, 15·outputs)`), center anchors, port anchors and label metrics are identical; the only DOM drift is a cosmetic ≤4px outer-`getBBox()` halo. Pinned by `tests/unit/toolkit/render/editor-metrics-fixture.test.ts` (schema sanity, empirical invariants, and a cross-version drift test that fails loudly with a per-node table if a future re-capture diverges). Recorded assumption: 4.0.x is dimension-identical to 4.1.x (the appearance rework shipped in 5.0).
- New `scripts/eval/cdp.mjs`: shared Chrome-DevTools-Protocol automation module (launch/connect/navigate/evaluate/dump/screenshot/close) built on the existing `ws` dependency — the single browser stack for this capture, the REND-7 fidelity harness, and EVAL-2 screenshot legs; no playwright/puppeteer added (`puppeteer-core` stays the documented fallback). New `scripts/editor-metrics-dump.mjs` runs the capture against a local stack, dismisses the editor telemetry/tour modals server-side, and restores the previously deployed flows afterwards. Capture is one-time and committed — CI never runs it; the full recipe (including the 5.0 compose-override leg) is in `docs/EVALUATION.md` "Editor ground-truth metrics".

### EVAL-1 — Promote the MCP eval driver: budgets, sections, expectations, harness-fault fixes

- The eval driver from the 2026-06-10 layout audit is promoted from gitignored `eval-results/` into the repo as `scripts/eval/driver.mjs` — a real MCP stdio client driving the server binary exactly as an agent would, now with a per-section **budget account** (`scripts/eval/budget.mjs`: `mcp_calls`, `failed`, `exec_steps`, `total_invocations`, `deploy_confirmations`, `elicitation_declines`, `force_uses`, `force_takeover_uses`, `oob_mutations` + `checkBudget`). Steps-file **schema v2** adds sections with budgets, `expect` machinery (`error`/`match`/`not_match`), `mutates` (out-of-band mutation marking), and `elicitation: accept|decline` (the driver answers the server's deploy-consent elicitation; no directive means decline). Exit codes: 0 pass, 1 budget/expectation gate fail, 2 run aborted.
- Harness faults from the audit are structurally fixed: **`$PREV` poisoning is a hard error** — referencing the previous call after it failed, returned non-JSON, or with a path that resolves to `undefined` aborts the run instead of substituting a stale value (kills the 79-call-cascade class, audit ledger e3#6); an **EPIPE guard** ends the run quietly when the downstream pipe closes; **`FLOW_OTTER_CMD`** selects the server command (defaults to `node dist/bin/flow-otter.js`).
- **Anti-gaming steps-file lint** (fix-plan gates blocker): any tool-call payload containing position fields (`position` keys, numeric `x`/`y`) inside a section flagged `layout_computed: true` fails the run before any call is made — the mechanical "position-free" assertion behind the FULLY FIXED replay legs.
- Pulled forward from EVAL-5 so the Phase-1 canaries don't depend on Phase 2: the shared **wiring-map/idempotence comparator** (`scripts/eval/compare.mjs`) — `compareWiring`/`wiringFingerprint` for wiring-map byte-identity and `canonicalFlowsHash` for scenario-level idempotence, pinned byte-equivalent to the server's `canonicalHash`.
- `docs/EVALUATION.md` gains the driver guide and the **normative budget glossary**, including the counting boundary cited by later gate acceptance tests. Every counting rule is pinned in `tests/unit/scripts/eval/` (budget/driver-helpers/compare suites); the driver itself is exercised against the live compose stack in `tests/integration/eval-driver.test.ts` (pass, budget-violation exit 1, expect machinery, poisoning abort, lint abort, elicitation accept/decline with confirmation counting).

### WSB-5-PR1 — Extract `compileValidateAndStage` + async-op widening (pure refactor)

- The shared staging-pipeline tail (ONE compile → no-op refusal → policy → validate → lint → diff → ONE `staging.write` → audit-enrich) is extracted from `runStagedAuthorOp` into an exported `compileValidateAndStage(ctx, prior, nextSpec, meta)` in `src/server/tools/author/_stage-pipeline.ts`, so per-op author tools and the upcoming `stage_changes` atomic batch (WSB-5 PR-2/3, v1.5.0) share a single safety choke point. The pending-stage guard + WSB-3 auto-clear stay at pipeline start (batch start, for batches); the auto-clear diagnostic threads through `meta.autoClearDiagnostic`. Zero behavior change — pinned by the existing stage-pipeline suites plus a new explicit `staged_hash` byte-identity regression (`tests/unit/server/tools/author/compile-validate-and-stage.test.ts`).
- `runStagedAuthorOp`'s `op` callback is widened to accept async functions (`AuthorOpResult | Promise<AuthorOpResult>`) — owned here per the fix plan's binding `_stage-pipeline.ts` merge order, deleted from LAYO-6's scope. All existing sync callers are unchanged.
- A clearly marked REND-8 seam comment sits strictly after `staging.write` inside the extracted tail: stage-output enrichment (before/after render paths) lands there, output-only, never affecting staged bytes or hashes.

### WSB-6 — Casing/ownership/vocabulary reconciliation (SD6)

- `get_staged_change` now emits canonical **snake_case** fields — `staged_hash`, `based_on_snapshot_hash`, `based_on_rev`, `staged_at` — so its `staged_hash` feeds `deploy_staged_change` without renaming (fixes the 2026-06-10 audit e2#7 casing mismatch). The legacy camelCase duplicates (`stagedHash`, `basedOnSnapshotHash`, `basedOnRev`, `stagedAt`) are dual-emitted for this one minor release, deprecated, and **slated for removal in v2.0.0** (supersession recorded here).
- `get_staged_change` additionally reports `agent_id` (session that staged the change; null for pre-v0.6.0 stages), `owned_by_current_session` (false means deploy/discard needs `force_takeover:true` — mirrors `deploy_staged_change`'s ownership check, including the no-agent_id back-compat path), and `stale` (true when the staged bytes are byte-identical to the current runtime, i.e. the next author op will auto-clear the slot per WSB-3; null when the runtime is unreachable).
- `move_node` gains `tab_id` as the canonical tab parameter — the same vocabulary as every other author tool. `source_tab_id` stays accepted as a deprecated alias (strictly additive; removal slated for v2.0.0); supplying both requires agreement. Owns audit ledger e3#2 together with the new `param-vocabulary` soft nudge (`src/server/nudges/rules/param-vocabulary.ts`), which fires when a successful `move_node` call still used the deprecated alias.
- Docs: `FLOWOTTER_SESSION_ID` (shipped v0.6.0, undocumented since) is now documented in a new `docs/CLIENT_CONFIG.md` "Staging ownership" section covering the session-identity model, `force_takeover` recovery, and WSB-3's hash-equal auto-clear; `TOOL_REFERENCE.md` / `AGENT_QUICKSTART.md` updated to match. The docs presence is pinned by a new unit test (`tests/unit/docs/client-config-coverage.test.ts`) replacing the fix plan's "CHANGELOG review" fallback.

### WSB-3 — Stage-time no-op refusal + auto-clear of hash-equal stale stages (SD3 pipeline half, SD6 half)

- Author tools now REFUSE at stage time when the compiled result is byte-identical to the current runtime flows (`ValidationFailedError`, "produced no change"; nothing is written to the staging slot). This tightens `REQUIRE_DIFF_BEFORE_DEPLOY` from deploy time to stage time and kills the 2026-06-10 audit e1 poison cascade where node tools addressed at junctions/comments silently staged no-change stages. The refusal message points at the object-kind confusion (node vs junction vs comment vs group). The op-layer silent-false return shapes are untouched (their flip to throwing is owned by WSB-4, v1.5.0).
- A pending staged change whose `staged_hash` is byte-identical to the current runtime flows is now auto-cleared — regardless of which agent process staged it (byte-equality means it carries no undeployed work, so clearing is information-lossless by construction) — and the new op proceeds, surfacing an info diagnostic `staging/auto-cleared-stale-stage`. Fixes the audit e2 restart friction where a stale leftover `staged.json` from a previous session blocked every author call. Auto-clear can never mask drift: it fires only on byte-equality with the live runtime.
- A hash-UNEQUAL pending stage still blocks exactly as before, and the refusal message now names `force_takeover` so a foreign-agent stage is recoverable via `discard_staged_change` without spelunking.

### WSB-1 — Structured error payloads through stdio (SD2)

- Tool errors crossing the stdio transport now carry their machine-readable cause. The single text content block keeps the legacy human-readable first line (`Tool '<name>' failed: <message>`, byte-identical) and appends a JSON block `{"error": {"name", "message", ...}}` — `ValidationFailedError` contributes its `diagnostics` verbatim (capped at 50 with a `diagnostics_truncated` marker), `DriftError` contributes `expected_hash`/`actual_hash`. Fixes the 2026-06-10 audit e2 defect where "add_node produced flows with 1 validation error(s)." reached the agent with the diagnostics dropped at the transport.
- New `src/server/transport/tool-error.ts` documents the additive payload contract, including the reserved `failed_op_index`/`failed_op` fields the `BatchOpError` branch (WSB-5, v1.5.0) will populate without reshaping.
- Success-path serialization is untouched and now pinned byte-identical by an over-the-wire integration regression (`tests/integration/tool-error-transport.test.ts`).

### EVAL-7 — Ratify the rollout spine in DESIGN.md + sanitized audit record

- `docs/DESIGN.md` Part I is now **ratified as amended** by the 2026-06-10 layout-audit fix plan: a ratification record binds the fix-plan phases (Phase 1 → v1.4.0, Phase 2 → v1.5.0, Phase 3 → v2.0.0, Phase 4 FULLY FIXED) to their work-item ids, names the five frozen cross-stream contracts, and records deferrals (e1#13 debug-buffer laziness with owner on record; e2#12 and e2#13 wontfixes). Amendments recorded: the stage-over-stage refusal already exists at HEAD (Phase-0 item 2 corrected — the remaining Phase-1 staging guards are WSB-1/WSB-3/WSB-6); the Phase-0 live half-day spike is restored as the binding Phase-1 live-session exit requirement; `stage_spec` moves to fix-plan Phase 3 so the flagship never ships with naive placement; fix-plan D-3's output-schema growth is versioned v1.5.0 additive.
- Committed the full sanitized audit report as `docs/audits/2026-06-10-layout-audit.md` and the fix plan as `docs/plans/2026-06-10-fix-plan.md` (both privacy-scanned; sterile-stack artifacts only).
- Fixed the stale `docs/EVALUATION.md` claim that npm `files` ships `docs/` — the tarball ships only `dist`, `README.md`, `CHANGELOG.md`, `LICENSE`; docs hygiene remains release hygiene via the public GitHub repo.

### Eval-driven hardening + Node-RED 5.0 GA support

Driven by the first full evaluation campaign (real MCP stdio sessions against live Node-RED 4.1.11 and 5.0.0 stacks; see docs/EVALUATION.md). Every item below traces to an empirically observed failure.

#### Safety

- **`deploy_staged_change` consent split** — new `confirm:true` flag records explicit user consent for clients without elicitation support, with the drift check FULLY ACTIVE. Previously those clients had to pass `force:true`, which also waived drift protection — the eval demonstrated a forced deploy silently overwriting a concurrent out-of-band edit. `force:true` remains the explicit drift override (implies consent). Drift refusals now name the remediation (`discard_staged_change` + re-stage, or `force`).
- **Stage-overwrite refusal** — author tools refuse to stage over an undeployed staged change instead of silently discarding it (the eval lost a staged node to this footgun with zero warning). New `discard_staged_change` tool (author tier) is the explicit escape hatch, with the same cross-agent `force_takeover` guard as deploy.

#### Authoring correctness

- **Group geometry auto-fit** — groups authored without explicit `position`/`size` now compile to a deterministic, grid-snapped bounding box computed from their members. Authored groups also receive the Node-RED editor's default visible style (`stroke:#a4a4a4`) when none is supplied — a group with no style (or the `style:null` Node-RED normalizes it to) renders an INVISIBLE box, so the group was structurally present but unseeable by reviewers; the renderer fix was confirmed live in the editor. `decompile` strips the default so re-staging stays idempotent. Node-RED does NOT auto-fit dimension-less groups on import (verified live: the runtime stores null geometry and the editor renders nothing — the eval's group was invisible in both the editor and `render_flow_svg`). Explicit geometry is preserved verbatim; groups with no positioned members keep the legacy omit behavior.
- **11 new per-type passthrough schemas** — inject, debug, function, mqtt in/out, link in/out/call, catch, status, complete. These common types previously had NO validation on any path (the specialist tools accept passthrough verbatim — contrary to what the docs claimed). Registered in the generic `add_node` registry; when `passthrough` is omitted and defaults satisfy the schema, runtime-required defaults (inject `repeat`, complete `scope`, link `links`) materialize automatically.
- **Diagnostics dedup** — staged-op responses no longer repeat identical validator/lint findings.

#### Node-RED 5.0 GA (released 2026-06-09)

- **Capability matrix corrections** — `functionLinkCall` and `adminCorsDefault` both gate on `5.0.0-beta.6` (the betas where PR #5494 / #5652 actually shipped; previous ranges misclassified beta.1–beta.5).
- **9 new capabilities** — `delayBurstMode` (≥5.0.0-beta.2), `tlsPfx`, `tlsEnvVars`, `credsAlongsideFlows`, `oauthCodeExchange`, `httpRequestSni`, `esmNodeModules` (GA-only), `nodeDefaultsOverride` (≥4.1.9 — a 4.1 feature commonly misattributed to 5.0), `markdownGhAlerts`.
- **Delay `pauseType: 'burst'`** accepted by the delay schema — previously a valid 5.0 burst-mode flow failed FlowOtter validation (the only hard 5.0 break found).
- **Support statement** — Node-RED 4.0 minimum / 4.1.x recommended / 5.0 GA supported. Verified empirically: the full author→deploy→validate loop and the integration suite run unchanged against 5.0.0. Password-grant/Bearer auth confirmed unaffected by 5.0's exchange-code change.
- **Test stack bumped** `nodered/node-red:3.1` → `4.1` (3.1 was below the project's own documented minimum).

#### Test suite repairs (pre-existing breaks; 82/82 integration tests now pass on a clean checkout)

- Integration rig now enables the `author_specialists` toolset (tests were never migrated when v1.3.0 moved specialists out of the default surface — 19 tests failed `Tool not in registry`).
- Integration deploys pass `confirm:true` (the suite predated v1.3.0 elicitation; every deploy was blocked in a rig without an MCP client).
- `agent-journey` / `multi-target-swap` state dirs moved from `os.tmpdir()` (outside `$HOME`, rejected by the v1.2 path policy on macOS) to `~/.flow-otter/integration-tmp/`.
- `read-tools` re-seeds its fixture instead of trusting the global-setup seed to survive earlier test files' deploys.

#### Review & test hardening

A 33-agent adversarial review (5 lenses → verify → synthesize) over this session's diff found 0 critical / 0 high; 15 confirmed (all medium/low/nit), 12 refuted. All confirmed findings fixed:

- Docs: AGENT_QUICKSTART deploy-flag guidance corrected (confirm vs force), stage-pending + DriftError + group auto-fit/style notes added; README/TOOL_REFERENCE tool counts (~47 default-visible / 66 total) and test counts refreshed; `discard_staged_change` listed in README.
- Tests: diagnostics-dedup; group auto-fit with junction/comment members and nested-group omit; `force:true` still bypasses drift (backward-compat); `add_node` default-materialization for a schema WITH defaults (inject) and one with required fields/no default (change must not throw); delay burst mode; plus a live integration round-trip proving the inject `repeat` default survives a real deploy.

#### Tooling

- `npm run privacy:scan` (+ `:staged`, `:history`) — repo hygiene scanner for the public repo; generic patterns ship in-repo, personal patterns stay in `~/.flow-otter/privacy-patterns.txt` (never committed). See docs/EVALUATION.md.
- `docs/EVALUATION.md` — scenario-driven evaluation playbook with phase gates; `eval-results/` is gitignored.
- npm `files` no longer ships `docs/` (npm pack publishes the live worktree — untracked drafts under docs/ would publish silently).

### Dev-dep refresh: vitest 2 → 4, vite 5 → 8, esbuild 0.21 → 0.27

Cleared the two open Dependabot advisories (esbuild dev-server CVE, vite `.map` path traversal) by bumping the test toolchain in lockstep. No production-dep changes; the published `dist/` tarball is unchanged. `npm audit` (with and without `--omit=dev`) now reports 0 vulnerabilities.

#### Test config changes

- **`vitest.integration.config.ts`**: dropped `pool: 'forks'` + `poolOptions: { forks: { singleFork: true } }`. Vitest 4 removed `poolOptions` from `InlineConfig`. The existing `fileParallelism: false` (combined with vitest 4's default fork pool) preserves the "one shared Docker Node-RED runtime across all integration files" guarantee.
- **`vi.fn()` typing**: vitest 4 narrowed the default `Mock<Procedure>` type so it no longer assigns to a typed function slot. Two test files were updated to `vi.fn<typeof fetch>()` with matching variable annotation.

#### Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run test:unit`: 579 tests (unchanged count, all pass under vitest 4).
- `npm run test:property`: 17 tests (unchanged, pass under vitest 4 with `numRuns: 1000`).
- `npm audit`: 0 vulnerabilities (was 2 moderate dev-only).

## 1.3.0 — 2026-05-19 — Architectural redesign: methodology, catalog, layout, dashboards, ISA-101

The 13-item plan in `docs/REDESIGN_PLAN.md` is complete. FlowOtter
gains a methodology playbook surfaced in MCP instructions, a structured
capability catalog, Node-RED version detection with feature gating, a
plan_flow methodology spine, a response-side soft-nudge guidance
system, named toolsets for progressive disclosure, MCP elicitation
gating destructive operations, a dual dagre/ELK layout engine,
authoring schemas for the full Dashboard 2.0 widget catalog, ISA-101 /
operator-screen validators, and 5 user-facing slash-command
MCP prompts.

All 13 items shipped:

### Item 1 — MCP server `instructions` field

Adds `SERVER_INSTRUCTIONS` (≤2KB methodology playbook) to the MCP server initialization in `src/server/transport/stdio.ts`. Clients that surface server instructions (Claude Code) now read the FlowOtter 4-phase pipeline (PLAN → ORGANIZE → STRUCTURE/WIRE/LAYOUT → REVIEW/VALIDATE/DEPLOY), the organize decision tree, and references to the new `plan_flow` / `get_authoring_guide` / toolset discovery tools.

### Item 2 — `get_authoring_guide` capability catalog tool

New read-tier tool returning the structured capability catalog: Node-RED concepts (11), core node types (40+), Dashboard 2.0 widgets (24, with FlowOtter status flags), all built-in templates (sourced dynamically from `BUILTIN_TEMPLATES`), validators (18), ISA-101 design principles (8), and the authoring methodology. Two completeness tests lock the catalog against drift — every validator file on disk must have a catalog entry and vice versa.

### Item 3 — Node-RED version detection + capability matrix

`src/adapters/nodered/capabilities.ts` ships an inline SemVer parser/comparator tuned for Node-RED's `MAJOR.MINOR.PATCH[-prerelease]` format and a feature→version-range matrix covering `groupNesting`, `junctions`, `subflowPerInstanceConfig`, `functionLinkCall`, `adminCorsDefault`, etc. `NodeRedClient.getNoderedVersion()` probes `/settings`; `health_check` exposes the runtime block (`name, version, is_prerelease, node_js_version?, detected_at, capabilities`). Cache is lazy-built and invalidated on `set_target`. Published support matrix: 4.0 min, 4.1.x recommended, 5.0.0-beta best-effort.

### Item 4 — `plan_flow` methodology spine tool

New author-tier tool that takes a goal + ordered stages with explicit organization decisions (inline/group/subflow/separate_tab), validates the plan, picks a layout strategy (auto-selects ELK when groups/subflows are declared or total nodes ≥ 30), and persists to `~/.flow-otter/<env>/staging/plan.json`. Returns `plan_id`, `next_actions[]` referencing real tool calls, and `warnings[]` for off-shape plans (large stages, single-stage plans, inline organization with ≥5 nodes). The tool acts as a state-tracking scaffold whose schema teaches the methodology — it doesn't reason on its own, only records the plan for downstream consumers.

### Item 5 — Soft-nudge / response-side guidance system

Generalizable response-augmentation layer in `src/server/nudges/*` that wraps every tool invocation, builds a `NudgeContext` from the live staging directory + plan record, evaluates applicable nudges, and appends `_guidance: string[]` to the tool's return value. Two initial rules: `no-plan-for-large-flow` (fires on authoring tools when staged ≥ 10 nodes without a plan_flow record) and `deploy-without-preview` (fires on `deploy_staged_change` when `preview_flow_diff` wasn't called this session for the current `staged_hash`). Defensive — nudge failures are logged and ignored, never break the tool call.

### Item 6 — Toolsets / progressive disclosure

`src/server/tools/toolsets.ts` defines 9 named toolsets (core, discovery, analyze, snapshots, audit, author, author*specialists, deploy, dangerous). Default surface drops from ~62 to ~52 tools by hiding the 11 specialist `add*\*\_node`tools behind`author_specialists`. New tools `list_available_toolsets`and`enable_toolset`let agents discover and enable additional toolsets at runtime. Registry rewritten to track enabled state in-memory and filter`listTools()`/`find()`through it. Dangerous toolset auto-enables when`ENABLE_DANGEROUS_TOOLS=true` so the existing security gate remains the single signal.

### Item 7 — MCP elicitation gates destructive operations

`src/server/elicitation/client.ts` is a typed wrapper around the MCP SDK's `elicitInput`: takes a `{message, fields, required}` request, builds a JSON-Schema object form, checks client capabilities, returns a 4-state outcome (accept/decline/cancel/unsupported). `deploy_staged_change` now elicits a confirm before pushing to the live runtime unless `force:true` is passed. Clients without elicitation support get a `ToolBlockedError` pointing at force or a newer client. Transport failures degrade to cancel — never silent-deploy.

### Item 8 — Layout engine: dagre v3 + elkjs opt-in

Swaps the abandoned `dagre@0.8.5` for `@dagrejs/dagre@3` (TS-native rewrite, March 2026). Adds `elkjs@^0.11` and `src/toolkit/layout/elk.ts` for port-aware, group-aware layouts. `src/toolkit/layout/index.ts` dispatches: ELK when groups are present, any node has ≥4 outputs, or total nodes ≥30; dagre otherwise. Agents can override with `engine: 'dagre' | 'elk' | 'auto'`. ELK config pinned for byte-stable determinism (`randomSeed: 1`, `considerModelOrder.strategy: NODES_AND_EDGES`).

### Item 9 — 10 missing Dashboard 2.0 widget schemas

`add_dashboard_widget` now accepts ui-button, ui-button-group, ui-text, ui-notification, ui-template, ui-form, ui-table, ui-chart, ui-gauge, ui-control. Schemas pin the key fields per widget and stay `.passthrough` for evolving Dashboard 2.0 config surface. ISA-101 hooks land in the schemas themselves — ui-button/ui-button-group accept `confirm: boolean`, ui-chart accepts `xAxisLimit: number`. Catalog flips all 10 widgets from `missing` to `supported`.

### Item 10 — Operator page templates

FlowOtter ships 9 ISA-101-aligned page templates under `dashboard_2_*` names: alarm_panel, audit_log_tail, command_panel, confirmed_button, gauge_grid, live_value, mode_banner, table_log, telemetry_chart. They were already in the codebase but classified as generic 'dashboard'. The catalog now categorizes them as `operator` so agents querying `get_authoring_guide(['templates'])` find them by intent. No template duplication.

### Item 11 — ISA-101 enforcement validators

Four new validators in `src/toolkit/validate/rules/`:

- **`unbounded-chart-append`** (warning): ui-chart with `action:'append'` must declare `xAxisLimit`. Prevents unbounded in-browser data growth.
- **`screen-clutter`** (warning): flags ui-group with >12 widgets and ui-page with >6 groups. density thresholds derived from operator-UI guidance; tunable via options.
- **`saturated-color-outside-alarm`** (warning): detects hex colors with HSL saturation >0.6 on widget color fields when the widget isn't in an alarm context. ISA-101 grayscale-90%.
- **`button-group-color-decoration`** (info): ui-button-group with 3+ options each using a unique color — color-as-decoration anti-pattern.

The existing `dashboard-2-destructive-needs-confirm` validator already covered the 5th planned rule (destructive-command-no-confirm).

### Item 12 — User-facing slash-command prompts

Declares the `prompts` MCP capability and registers 5 prompts that surface as `/mcp__flow-otter__<name>` slash commands:

- `new_flow(goal, template?)` — full plan → wire → deploy walkthrough.
- `build_operator_dashboard(dashboard_type, title)` — maps 7 dashboard_type values to operator templates from Item 10.
- `refactor_to_subflow(tab_id, node_ids, subflow_name)` — fold selected nodes into a reusable subflow.
- `explain_my_flow(tab_id?)` — structured walkthrough.
- `review_my_flow(tab_id?)` — full review pass with ISA-101 explanations.

Together with the server instructions (Item 1), capability catalog (Item 2), and methodology spine (Item 4), the discovery story for both agent and user is now complete.

### Item 13 — Core vs contrib node-type discrimination

`list_installed_node_types` now annotates each type with `is_core: bool` (from the catalog's `core_node_types`) alongside the existing `has_schema: bool`. Agents can classify any installed type at a glance:

- core + schema → specialist tool available
- core + no schema → generic add_node
- contrib + schema → typed contrib (rare)
- contrib + no schema → passthrough validation (the long tail: Modbus, InfluxDB, OPC UA, etc.)

Per Decision 1 of REDESIGN_PLAN.md, generic add_node handles every case; specialists are a convenience layer. Junction nodes, function-node libs, per-instance subflow config, and tab markdown info work via generic add_node + passthrough — that's the correct architectural answer for the contrib-first stance.

### Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run test:unit`: 738 tests pass (up from 603 at the start of v1.3.0).
- `npm run test:property`: 17 tests pass.
- `npm run build`: clean.
- New deps: `@dagrejs/dagre@^3`, `elkjs@^0.11`. Removed: `dagre@0.8.5`, `@types/dagre`.

## 1.2.0 - 2026-05-16 — Security hardening + non-idempotent-retry guard + correctness audit

Second-round-review pass: closes path-traversal exposure on `set_target`, fixes a subflow-instance authoring bug that left every staged subflow failing validation, eliminates an audit race against `set_target`, surfaces silently-dropped authoring refs as diagnostics, hardens HTTP retry semantics for non-idempotent operations, and wires sensible network timeouts.

### Security hardening

- **Path-traversal on `set_target`** — `env_name`, `snapshot_dir`, `staging_dir`, and `audit_log_path` were agent-supplied path-traversal vectors. New `src/server/policy/path-policy.ts` rejects illegal `env_name` characters (allowed: `[A-Za-z0-9._-]`, ≤ 64 chars, no leading dot, no `.`/`..`) and requires absolute custom paths to resolve inside the user's home directory. Defense-in-depth: same validation runs in `applyTarget`, `readPersistedTarget`, and `writePersistedTarget` so a malicious `target.json` or `ENVIRONMENT_NAME` env var cannot escape the state sandbox.
- **`prepare_dangerous_operation` token scope** — previously could issue tokens for `create_flow` / `update_flow` / `delete_flow` without the `target` + `flows_hash` scopes the execute tools require. Now refuses with a clear error so callers don't get an unusable token. (`replace_flows` + `delete_tab` were already correctly scoped.)
- **Audit attribution race** — `makeInvokable` previously read `container.config` and `container.flowSource` live at audit-event creation time. A tool that rebinds the container mid-call (`set_target` is the canonical example) caused the audit row to attribute the call to the post-rebind environment. The invocation now snapshots `actor`, `environment`, `flow_source`, and the audit sink at call start.
- **WebSocket connect timeout** — `NodeRedCommsClient.openSocket()` could hang forever waiting on `open`/`close`/`error` if the TCP handshake stalled. Hard timeout (default 10s, configurable via `REQUEST_TIMEOUT_MS`) now terminates the socket and frees the awaiter.
- **Auth fetch/revoke timeout** — `PasswordGrantAuth.fetchToken()` and `PasswordGrantAuth.revoke()` were unbounded fetches; an unresponsive Node-RED could stall the call AND the shutdown path. Both now use `AbortController` with `REQUEST_TIMEOUT_MS` (default 30s).

### Correctness fixes

- **Subflow-instance authoring** — `add_subflow_instance` stored `type: subflow:<authoringKey>` and compile didn't rewrite it to `subflow:<noderedId>`, so the `subflow-ports` validator failed every staged subflow ("references missing subflow definition"). Compile now pre-resolves subflow-def ids and rewrites instance types at emit time. Decompile reverses the rewrite so the spec stays in agent-friendly `subflow:<authoringKey>` form.
- **Authoring-ref drop diagnostics** — compile previously dropped unresolved wire targets, group `nodeKeys`, group `parentKey`, node `groupKey`, and node `widgetAnchor.refKey` silently. Compile now returns a `diagnostics: CompileDiagnostic[]` array; the stage pipeline merges these into its `diagnostics` output so the agent sees `compile/unresolved-*` warnings instead of silent data loss.
- **Output-port modeling for switch/trigger/delay** — `getOutputPortCount` only honored `function.outputs`. The spec schemas allow `outputs` on `switch` and `trigger` (and the schema for `switch` also permits multi-output via `rules.length`). Compile now honors `passthrough.outputs` for `function`, `switch`, `trigger`, `delay`, and falls back to `rules.length` for `switch` when `outputs` is absent. Multi-output wiring no longer silently truncates to one port.

### HTTP retry semantics

- **Non-idempotent ops no longer retry** — `request()` retried 5xx and network errors generically. For `POST /flow` (create) and `DELETE /flow` (the per-flow CRUD endpoints) a retry after a successful server-side mutation could duplicate or misreport state. Retries are now gated on method idempotency: `GET`, `PUT`, and `POST /flows` (bulk replace, body-idempotent + caller-side rev-mismatch recovery) retry as before; `POST /flow` and `DELETE /flow` fail fast.

### Release packaging

- **`prepack` hook** — `package.json` now runs `npm run build` before pack. `dist/` is gitignored, so previously `npm pack` from a fresh clone produced a tarball with no compiled artifacts. The hook closes that gap so `npm install` from a git ref or tarball always has a runnable `bin/`.
- **`package-lock.json` version drift fixed** — root `version` field now matches `package.json`'s `1.2.0`.

### Stale docs

- `docs/TOOL_REFERENCE.md` corrected: 60 tools (was 58).
- `docs/PARALLEL-SESSIONS.md` corrected: the auth-env-var-ref scheme is shipped (since v0.5.0), not planned.

### Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run test:unit`: 579 tests across 81 files (was 538/80; +41 new for path policy, audit race, dangerous-token scope, output ports, compile diagnostics, HTTP retry semantics).
- `npm run test:property`: 17 tests (round-trip arbitraries continue to exercise junctions, tab locked/env, group geometry, comment size, subflow instances at numRuns: 1000).
- `node scripts/check-tool-coverage.mjs`: 60/60 tools covered.
- `npm audit --omit=dev`: 0 vulnerabilities.

### Breaking changes

- `set_target` now rejects `env_name` containing path separators, `..`, `.`, leading `.`, or characters outside `[A-Za-z0-9._-]`. Calls supplying state-directory overrides outside the user's home directory are also rejected; operators who need state on a different root must set `SNAPSHOT_DIR` / `STAGING_DIR` / `AUDIT_LOG_PATH` via process env vars at startup.
- `compile()`'s return shape adds `diagnostics: readonly CompileDiagnostic[]`. Existing consumers that destructure `{ flows, hash }` continue to work.
- `prepare_dangerous_operation` now refuses unscoped tokens for `create_flow` / `update_flow` / `delete_flow`. Existing callers that already supplied the required scopes are unaffected.
- `POST /flow` and `DELETE /flow` no longer retry on 5xx / network errors. The change is a safety upgrade — duplicate-mutation hazards under retry — but a previously-flaky operator setup may see new errors instead of silent retries.

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
- `npm run test:unit`: 541 tests across 80 files (was 521/79; +20 new — roundtrip fidelity, tool-ID symmetry, policy enforcement, deploy gates).
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
- **OAuth/PKCE auth strategy** for hosted Node-RED targets that require it.
- **Per-flow CRUD tools** (`get_flow`/`create_flow`/`update_flow`/`delete_flow`) — Admin API endpoints stable since Node-RED 0.19; not yet exposed at the MCP layer.

## 0.6.0 - 2026-05-10

Closes most of v0.5.0's "Deferred to v0.6.0+" queue: Dashboard 2.0 widget breadth (14 new widget types reachable), MCP-spec annotation hints for client interop, line-based patches on `update_node`, the destructive-action validator that completes the v0.5.0 confirmed-button pattern, stage-pipeline helper, per-session staging guard, partial-deploy + rev-race fixes. Same-day follow-up to v0.5.0.

### New tools

- **`add_dashboard_widget`** (author tier): typed creation for **14 Dashboard 2.0 widget types** previously unreachable cleanly — `ui-dropdown`, `ui-radio-group`, `ui-slider`, `ui-switch`, `ui-text-input`, `ui-number-input`, `ui-file-input`, `ui-markdown`, `ui-progress`, `ui-audio`, `ui-spacer`, `ui-event`, `ui-link`, plus dialog-mode `ui-group` as a config-node variant. Per-widget Zod schemas in `src/toolkit/authoring/widget-schemas.ts`. Anchor resolution per type (`group`, `ui`, `none`, or `config` for dialog).

### MCP-spec annotation hints on Tool interface

- New `ToolAnnotations` type (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` / `title`) per MCP 2025-03 spec. Sensible per-tier defaults derived by `defaultAnnotationsForTier` — read/validate = readOnly+idempotent, author/stage = mutates-local-not-runtime, deploy = destructive+open-world, dangerous = same as deploy. Per-tool overrides supported via optional `annotations` field on `Tool`.
- Stdio transport propagates annotations on `tools/list` so Claude Desktop / Cursor / other MCP clients can surface the right intent badges in their UI.

### Line-based patches on `update_node`

- `update_node` now accepts `patches: [{property, op:'replace'|'insert'|'delete', start, end?, content?}]` for **token-efficient edits to long-string passthrough fields** — function-node `func`, ui-template `format`, template-node `template`. Line numbers are 1-indexed on the ORIGINAL content; non-overlapping patches required (throws `PatchError` on overlap). Per-property batches: passthrough merge first, then patches.
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
