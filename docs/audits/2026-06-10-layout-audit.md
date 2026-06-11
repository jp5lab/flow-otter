# FlowOtter Layout Audit — Synthesis Report

**Audit question:** When Claude Code authors or reorganizes a Node-RED flow through FlowOtter, can it produce a graphical layout a plant operator can read — signal lifecycle left-to-right (acquire → condition → decide → act → indicate), lifecycle stages visually grouped with headers, error paths in a lane BELOW the happy path, switch affirmative output on top, minimal wire crossings, no backward wires, grid-aligned spacing? Graphical positioning is co-equal with functional correctness.

**Subject:** FlowOtter v1.3.0, commit `0648c57` (HEAD, includes all 26 same-day campaign-1/2/3 fixes), against sterile Node-RED 4.1.11 + Mosquitto. Date: 2026-06-10.

---

## 1. Executive verdict

**NOT-YET.**

The layouts produced in this audit are genuinely operator-readable — e1 and e2 cold-read at 4.5/5 with zero narrative errors against ground truth, all eight criteria satisfied in the live editor — but FlowOtter did not produce them. The agent did, by acting as its own layout engine: importing the repo's width metrics offline, DOM-dumping the live editor to correct FlowOtter's 37–53px/node width error, and performing **five out-of-band admin-API/toolkit surgeries that the MCP surface cannot express** (comment removal/moves, group refits, second-tab grouping, junction repositioning). The costs blew every budget the project sets for itself — 278 calls/49 confirmations for a 14-node flow vs. a 50–70 estimate; ~6 calls per node for a layout-only tidy vs. a ≤3+1 Phase-1 target — which the project's own playbook scores as **FAIL** ("it worked eventually is a fail if the budget blew", EVALUATION.md:25). The visual feedback channel is doubly broken: the agent cannot view the SVG as an image, and the SVG itself draws a third geometry (top-left node anchors, collapsed switch ports, amputated junction wires) that disagrees with both the lint's boxes and the editor's pixels. Nothing in any MCP channel teaches the conventions the audit question names; readability today is delivered entirely by Claude's training priors plus expensive coordinate arithmetic. The S5 Phase-0 gate does not pass; the E4 probe shows the dormant engine would today _wreck_ exactly the organized flows the product tells agents to author. The good news is equally concrete: the safety/diff/staging spine held flawlessly across all four scenarios (zero data loss, zero forced deploys, byte-identical restoration), foreign-flow adoption works, and the v2 plan (D1–D6) aims at precisely the failures observed — it needs amendment, not replacement.

## 2. Scorecard

### Scenario × lens scores (0–5)

| Scenario                                                  | Cold-read                                   | Conventions | Friction                 |
| --------------------------------------------------------- | ------------------------------------------- | ----------- | ------------------------ |
| **e1** — greenfield lifecycle flow (14 nodes, MQTT alarm) | 4.5                                         | 4           | **1 (FAIL)**             |
| **e2** — spaghetti reorganization, second tab             | 4.5                                         | 4           | **1 (FAIL)**             |
| **e3** — S5 visual corrective loop drill                  | 4.5                                         | —           | **2.5 (FAIL on S5 bar)** |
| **e4** — internal dagre/ELK engine probe                  | 3 (best engine output; agent reference = 5) | **1.5**     | —                        |

Cold-read and conventions judges score the **pixels**; friction judges score the **path**. Both are correct and the divergence is the headline: the final screens pass the operator bar, the toolchain that is supposed to get an agent there fails its own playbook. Per EVALUATION.md principle 3, the friction FAIL governs the product verdict.

### Measured budgets vs. the project's own bars

| Bar (source)                                    | Target                                             | Measured                                                                                                                                                | Verdict                                           |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| v1 status-quo estimate (DESIGN.md Finding 3)    | 50–70 calls / ~15-node flow                        | e1: **278 calls, 49 confirmations, 158 failed calls** (clean-path ~109); e2: **74 calls, 12 confirmations, 22 failed** for a 12-node _layout-only_ tidy | 1.5–4× over even the pessimistic estimate         |
| v2 Phase-1 target (EVALUATION.md:99)            | ≤3 authoring calls + 1 confirmation                | ~5.7–6.2 calls **per node**; 12–49 confirmations per flow                                                                                               | ~25–90× over                                      |
| S5 visual loop (EVALUATION.md S5, DESIGN.md:94) | stage → see → adjust → re-see in **≤6 tool calls** | e3: 4 MCP-only, but **8 best-case / 13 as-executed** total invocations (SVG→PNG shells + Reads are inside the bar per DESIGN.md:94)                     | **FAIL**                                          |
| Out-of-band mutations required                  | 0                                                  | e1: 3 admin-API surgeries; e2: 2 toolkit operations (grouping/comments/junction impossible in-surface)                                                  | Pure-MCP completion **impossible** for both flows |

**S5 Phase-0 gate: NOT PASSED.** Honest counting blows the ≤6 budget; the qlmanage recipe silently amputated the right half of wide flows for 2 of 2 agents that tried it; and even a delivered PNG would show renderer geometry that mismatches the editor (§4, F2/F6/F7). Phase-0 exit cannot be declared at HEAD.

## 3. What works

Credit verified, not asserted:

- **The safety spine is real and held under abuse.** Zero data loss across 362 MCP calls and 65 deploys; drift detection coexisted with deliberate out-of-band edits; `force` (drift override) used 0 times across all scenarios; e3's fix deploy hash equaled the pre-defect snapshot hash — byte-identical restoration (e3-run-loop2-raw.jsonl). All 11 campaign-2 fixes held; no regressions found.
- **Foreign-flow adoption works.** Raw node ids work as `node_key` on flows FlowOtter never authored; e2's reorganization left wiring byte-identical on all 12 nodes and the sibling tab untouched (e2-before/after-flows.json byte diff).
- **Typed authoring is solid.** 14/14 `add_node` calls passed first try in e1 with minimal passthroughs; per-op diffs are truthful (e2 rename diff: exactly one field); validate honestly tracked 1 warning → 0.
- **Group auto-fit (this morning's fix) works at creation.** Deterministic grid-snapped bboxes, visible default style, live-verified in the editor (e1-render-v1-full.png; campaign-1.md #3). Residuals: no sibling-collision avoidance, geometry frozen afterward.
- **Grid discipline is the one delivered layout convention.** Coordinates auto-snap to 20px, the on-grid validator fires in every staged response — the single audit criterion with a number, a check, and an enforcement path.
- **The stage-time text lint caught a planted defect blind.** e3's bbox-overlap diagnostic named both nodes before deploy and before any render — overlap-class defects have non-visual coverage.
- **The layered-engine bet is salvageable.** On bare node-wire topology, ELK (post junction-workaround) took e2's spaghetti from 8 backward wires/4+ crossings to 0/0 in 37ms (e4-spag-elk.png). The gap to usefulness is bounded and matches D3's prerequisite list — see §5.

## 4. What fails

Twelve findings survived three-lens adversarial review (36 refutation votes; 0 findings refuted outright; 2 severity downgrades noted inline). Ordered by mission severity.

**F1 (critical) — No image affordance: the agent is blind.** `render_flow_svg` returns SVG XML as text in a JSON text block (src/server/tools/read/render-flow-svg.ts:14-19; src/server/transport/stdio.ts:96); no PNG tool, no image content blocks, no raster dependency exists at HEAD. Claude Code cannot view it (DESIGN.md:31). The entire prescribed render-review loop runs on raw coordinates or undocumented external shell conversion — where e3 lost a third of its budget and hit a silent square-crop trap. _Implication: the visual half of the product does not exist in practice; S5 cannot pass._

**F2 (critical) — Coordinate semantics inverted in the renderer.** svg.ts:196-209,269 draws node/comment x,y as TOP-LEFT; the editor — and FlowOtter's own compile.ts:309-319 auto-fit — treat x,y as CENTER. Every node renders displaced +w/2,+15px relative to groups; auto-fitted groups that correctly contain members in the editor render with nodes spilling out (e3-svg-left.png vs e3-editor-left.png: 3 false containment violations). _Implication: the agent's eye systematically lies about containment, alignment, gaps, and overlap — it will "fix" correct layouts and trust broken ones._

**F3 (critical) — Multi-output port collapse.** svg.ts:191-192 reads `outputs`/`rules` from a `passthrough` key that never exists on flows.json (compile spreads it top-level), so every switch renders ONE output port; wires exit outside the node body (blessed snapshot function*three_outputs.svg proves it; one judge calibrated this high rather than critical since wire-origin order survives). \_Implication: "affirmative output on top" — the audit's signature check — is unverifiable from FlowOtter's own render.*

**F4 (critical) — The readability conventions reach the agent through no MCP channel.** DESIGN.md:41 enumerates the full convention set; grep shows zero delivery code. SERVER*INSTRUCTIONS, catalog, prompts, and plan_flow all say \_layout is your job* without saying what good layout is (index.ts:93; data.ts:886-890; registry.ts:63). e1's run confirmed: `get_authoring_guide(methodology)` contained no grid size, pitch, lane, or range — every number was invented from priors or repo source. _Implication: layout quality is unguided and unreproducible; "the agent had to know X" is the operating mode, not the exception._

**F5 (high) — One-staged-op-per-deploy makes layout iteration cost-prohibitive.** \_stage-pipeline.ts:72-82 refuses any author op while a stage pends; move*node is one node, absolute coords (move-node.ts:15-22). Measured: 5.7–6.2 calls/node, 12–49 user confirmations per flow, and a single silent no-op (comment remove_node returning `removed:false` yet staging) poisoned **158 of e1's 278 calls** across two 79-call cascades. \_Implication: the single biggest cost multiplier on the audit question, independent of agent skill; D1/D2 batching is a prerequisite, not an optimization.*

**F6 (high) — Junctions render as full-size labeled nodes and their outgoing wires are silently dropped.** svg.ts:213-214 never walks junction wires; e4-spag-elk.png shows a connected alarm chain rendering as a disconnected island. _Implication: the render is blind to the connectivity of Node-RED's sanctioned crossing-reduction tool._

**F7 (high) — render_flow_svg renders the RUNTIME, not the staged change.** render-flow-svg.ts:34 loads the flow source; staged flows live only in ctx.staging. The server's own recipes order render _before_ deploy (registry.ts:105), at which point a pending op is guaranteed to exist and be absent from the image. _Implication: the prescribed pre-deploy visual review necessarily excludes the change under review._

**F8 (high) — Zero layout-quality lints.** Of 22 validators + 2 lint rules, the canvas-relevant set is exactly on-grid (warning), off-canvas (skips groups/comments), and a fixed-120×40 bbox-overlap (validate/index.ts:36-63; flows-lint.ts:24-25,74). E4 proved it empirically: the lint scored the audit's best layout and both group-wrecked engine outputs identically — 0 diagnostics — and gave the raw spaghetti (8 backward wires, right-to-left) only 5 warnings. _Implication: five of the eight audit criteria have no machine check; the D4 gate is unscorable with today's lint._

**F9 (high) — "Lint-clean ≠ editor-clean" is acknowledged but the offered mitigation widens it.** AGENT_QUICKSTART.md:247-248 routes review through a render this audit shows is unfaithful; at HEAD there are three disagreeing geometries (lint boxes, FlowOtter SVG, editor pixels). The campaign-2 headline — the invisible-group bug "only live vision caught" — is the project's own proof that editor-truth review currently requires the real editor.

**F10 (high) — The auto-layout engine is dead code, and the agent-supplies-every-coordinate path is the only path.** layoutFlows has zero production call sites, isn't barrel-exported, and no layout*flow tool exists (layout/index.ts:51-60; plan-flow.ts:43-44); elk/dagre hardcode 120px widths vs the renderer's 80–240px. One refutation judge downgraded this to medium (documented roadmap; manual path demonstrably met the bar in-audit) — recorded as contested, kept at high because the manual path's cost is what fails the friction lens. E4 adds the sharper point: wiring the engine up today would \_degrade* output (§5).

**F11 (high) — Width model diverges from the editor by +37–53px/node.** nodeWidthFor (metrics.ts:58-65, no icon term) underestimates real editor widths (DOM-measured: parse 107→160, debounce 163→220). A render-clean e1 layout had three node overlaps and a backward-bending wire in the actual editor; group fit pads inherit the error (nodes flush against borders). _Implication: even a delivered PNG vision loop validates the wrong geometry until metrics are editor-true (DESIGN.md open question 3 is load-bearing)._

**F12 (medium, severity contested 2-1) — Default placement overlaps by construction.** placeRightOf's effective 80px step vs 80–240px node widths (100px editor minimum) means chained `source_node_id` adds overlap in the editor and trip FlowOtter's own lint; the no-position fallback stacks a single column at x=160 — the opposite of left-to-right. The dissenting judge correctly notes the trap is loud (lint fires in the same response) and the path went unused in every recorded run; kept at medium. _Implication: the one place FlowOtter makes a spatial decision, it makes a wrong one._

### Scenario-verified defects outside the adversarial-review set (run record, triaged in §7)

These were empirically demonstrated by scenario agents and corroborated in source, but did not go through the 3-vote process:

- **Cross-tab authoring-key id collision hard-blocks add_group/add_comment on any second tab** once another tab has default-keyed groups/comments (compile.ts deriveId global fallback vs per-tab dedup; e2: 8/8 calls refused; completed out-of-band). Structurally blocks lifecycle grouping — the heart of reorganization — for a pure-MCP agent.
- **Validation failures are opaque:** the stdio transport drops `ValidationFailedError.diagnostics`, leaving "1 validation error(s)" with no cause (stdio.ts:98-104); one root cause became 8 undiagnosable refusals plus a 10-call cascade.
- **Junctions are unaddressable:** move_node not-found; update_node silent `ok:true/updated:false` no-op that occupies the staging slot.
- **Comments and groups are write-only:** no remove/move/update_comment, no update/remove_group; group geometry never refits after move_node — layout iteration with groups is a one-way door.
- **ELK crashes (`JsonImportException`) on any junction-bearing flow; dagre silently strands junctions at (0,0)** — and autoEngine routes grouped/large flows to the crashing path.
- **Process-pinned staging** (agent_id = pid) forces undocumented `force_takeover` on any client restart; `get_staged_change` returns camelCase `stagedHash` where deploy wants snake_case `staged_hash`.
- **explain_flow ignores junction edges**, misreporting entrypoints/sinks on exactly the flows being reorganized.

## 5. The v2 design, assessed against this evidence

**The skeleton is right; the substance of the audit question is missing from it.**

**What the evidence supports:**

- **D1/D2 (declarative spec + batch staging):** every friction measurement in this audit (F5; 278/74-call budgets; 158-call cascade) is direct evidence these are prerequisites. Confirmed necessary.
- **D3 (computed layout) — direction validated, prerequisites confirmed real:** E4 shows the layered engines fix direction and crossings essentially for free (spaghetti: 8→0 backward wires, 0 crossings, 1–37ms). The bet is sound.
- **D5 (render_flow_png to disk + image block):** precisely sized — e3's loop lands at exactly 6 calls with it. Confirmed necessary.
- **Rejecting layout-as-mandatory-compile-phase:** correct, given single-slot thrash and OT clobbering risk; E4's evidence that the engine _wrecks_ organized flows makes the opt-in stance look prescient.

**Where E4 and the renderer audit undermine v2-as-designed:**

1. **D3's prerequisite list is incomplete and the engine is further from done than the plan implies.** Shipped ELK has none of the listed prerequisites (no compound groups, no port constraints, fixed 120×30) — and E4 found prerequisites the list omits: junction handling is a _crash bug_ today; comments are not layout participants (stage headers pile at origin); the bounds clamp stacks nodes on the boundary; and nothing provides the **two-level architecture** (stacked lane compounds laid out LR internally + tab-level section stacking) that error-lane-below and multi-section tabs require. Both engines moved the error lane ABOVE the happy path; dagre inverted affirmative-on-top; ELK preserved it only by model-order luck.
2. **The spec has no lifecycle vocabulary.** "Lanes" appears twice in DESIGN.md, undefined; AuthoringSpec has no stage/lane/role field (and NodeSpec.position is _required_, contradicting the zero-coordinate pitch). The engine cannot compute "error lane below" from inputs the spec cannot express.
3. **D6's metric list is aesthetics-only.** No metric for error-lane-below, stage order, lifecycle direction, or header presence; E4 proved a lifecycle-scrambled flow can lint clean. D4's threshold is set post-hoc and "human eyeballs" is un-operationalized.
4. **D5 closes the loop against FlowOtter's renderer, not editor truth.** With F2/F3/F6/F11 unfixed, a PNG of the current SVG is a faithful picture of a wrong drawing; the graceful SVG-only degradation silently reopens the blindness gap.
5. **D4's benchmark tests the wrong path.** Stripping community-flow positions deletes the only semantic encoding those flows have, so the gate measures inference-only re-layout while the product's headline path (spec-authored, lifecycle-annotated) is never benchmarked.
6. **Phase-1 sequencing ships the flagship claim regressed:** stage_spec with "naive placement" (the overlapping placeRightOf of F12) for a whole phase, while the pitch sells computed legibility.

## 6. Recommendation: **v2-amended**

v1-patches cannot reach the bar — the failures are architectural (no batch, no computed layout, no faithful eye, no semantic vocabulary), exactly as DESIGN.md self-diagnoses. Full-redesign is not warranted: the safety spine, the spec/compile pipeline, the deterministic renderer skeleton, and the layered-engine bet all survived adversarial testing; E4 shows the gap is bounded and enumerable. v2's skeleton is right and its rejections were correct. What it needs is the audit question made first-class. Numbered requirements, each feeding D3/D4/D6 directly:

**R1 — Lifecycle semantics in the spec (amends D1/D3).** Add first-class `stage` (fixed taxonomy: acquire|condition|decide|act|indicate|custom), `lane` (main|error|indicate), and `role` (e.g. error-source for catch/status/complete) fields to NodeSpec/GroupSpec; make `position` optional when a spec is layout-computed. _Accept:_ a spec with zero coordinates and lane annotations compiles; catch-chain nodes default to lane=error without explicit tagging.

**R2 — Two-level layout architecture (amends D3 prerequisites).** Per-lane compounds laid out LR internally (ELK layered, FIXED*ORDER ports, measured editor-true sizes), stacked vertically with main lane above error lane; tab-level section stacking in declared narrative order (no disconnected-component area-packing); junctions and comments as layout participants (junction as 10px waypoint, stage-header comments anchored above their group); group geometry recomputed post-layout. \_Accept:* E4's two fixtures re-laid-out produce error-lane-below, affirmative-on-top, headers above stages, zero crashes on junction-bearing flows; output beats e4-e1-dagre/elk on the S6 rubric.

**R3 — Faithful eyes (amends D5).** Fix the renderer before delivering it: center-convention node/comment anchors, port counts from top-level `outputs`/`rules`, junction pass-through wires, editor-true width model (icon term + 20px ceil — resolve DESIGN.md open question 3 against editor view.js), staged-state rendering (`against: staged|runtime`). Then `render_flow_png` writing to disk + MCP image block with returned dimensions; hard-fail (not degrade) the visual-loop path when the rasterizer is absent; add a periodic editor-screenshot fidelity check to CI/eval. _Accept:_ S5 passes at ≤6 honestly-counted calls; render of e1-flows.json shows two switch ports, contained groups, no phantom config nodes; pixel positions match a live-editor DOM dump within ±2px.

**R4 — layout_lint with semantic rules (amends D6), wired into the read surface.** Crossings, backward wires, label occlusion (render dimensions), group/group overlap, canvas-width overflow vs a declared viewport — plus the semantic set this audit found missing: error-lane-below, stage left-to-right order, affirmative-output-on-top (port 0 geometry), header-presence per stage. Expose through validate*flow/analyze_flow, not only the write path. \_Accept:* lint separates e4-e1-agent (clean) from e4-e1-dagre/elk and e4-spag-raw (flagged) — the exact cases today's lint scores identically.

**R5 — Batch staging + full object lifecycle (amends D2; closes the e2 blockers).** `stage_changes` (atomic multi-op, one deploy/confirmation); move/update/remove for comments, groups (geometry + refit), and junctions; fix the cross-tab deriveId collision (per-tab id derivation or exposed `key`); refuse-at-stage-time when an op is a no-op (`removed:false`); auto-clear stages whose hash equals runtime; serialize ValidationFailedError diagnostics through the transport; reconcile stagedHash/staged*hash casing; document or soften process-pinned staging. \_Accept:* e2's full reorganization (5 groups, 3 comments, junction move, 12 repositions) completes pure-MCP in ≤5 calls + 1 confirmation with actionable error payloads.

**R6 — Teach the conventions in-band (no D-item today; smallest fix first).** Put the DESIGN.md:41 convention set, with numbers (20px grid, 140–220px column pitch, lane heights, viewport math: visible canvas ≈ window − 180 palette − 320 sidebar), into SERVER*INSTRUCTIONS' layout sentence, the catalog layout phase, and plan_flow output (spatial scaffold: stage columns + y-bands per lane). \_Accept:* a cold agent (S7) can state the eight criteria from MCP channels alone.

**R7 — Re-spec the gates (amends D4/S5/S6).** Pre-register the S6 threshold before the first scored run; blinded original-vs-relayout A/B forced choice; at least one operator-semantics criterion per flow; benchmark BOTH legs (stripped community flows AND spec-authored lifecycle-annotated equivalents); add one live-editor screenshot check to S5; count S5's budget over total invocations, not MCP calls only. _Accept:_ gates are scoreable by someone who didn't build the engine.

Priority order: **R3 and R5 first** (they unblock everything and fix active deception/blockage at HEAD), then R1+R2 together, then R4, with R6 shippable any time and R7 before any gate is declared.

## 7. Run record

Per docs/EVALUATION.md format.

- **FlowOtter:** v1.3.0, commit `0648c57` (main, clean tree; includes campaign-1/2/3 fixes of 2026-06-10 morning)
- **Node-RED:** 4.1.11 (sterile Docker stack, `localhost:1880`, no auth); Mosquitto at `localhost:1883` (`mosquitto:1883` in-container)
- **Date:** 2026-06-10 · **Agent/model:** Claude Code (Fable 5), scripted MCP drivers over stdio
- **Agent counts:** 4 code-audit agents (affordances, renderer, guidance, v2-critique) · 4 scenario agents (e1–e4) · 10 judge passes (e1×3, e2×3, e3×2, e4×2 lenses) · 36 adversarial refutation votes (12 findings × 3) · 1 synthesis. 12/12 findings survived; 2 severity downgrades recorded (F10, F12).

### Budgets

| Run               | MCP calls             | Deploys/confirms              | Retries/failed calls                                 | Out-of-band mutations | force:true |
| ----------------- | --------------------- | ----------------------------- | ---------------------------------------------------- | --------------------- | ---------- |
| e1 greenfield     | 278 (clean-path ~109) | 49                            | 158 failed (two 79-call cascades) + 4 retries        | 3 (admin API)         | 0          |
| e2 reorganization | 74                    | 12 (+3 force_takeover events) | 22 failed                                            | 2 (toolkit)           | 0          |
| e3 visual loop    | 10                    | 2                             | 1 driver re-run; loop = 4 MCP / 13 total invocations | 0                     | 0          |
| e4 engine probe   | 0 (internal)          | 0                             | 3 (ELK junction crash; qlmanage; magick)             | n/a                   | n/a        |

**Gate status:** S5 Phase-0 — FAIL (budget + fidelity). Phase-1 bar — not attempted, projected far over (no batch path). S6 — unscorable (no layout lint separates good from bad; E4 demonstrated).

### Artifact inventory

All under `eval-results/2026-06-10-layout-audit/`: per-scenario raw JSONL (`e1-raw.jsonl`, `e2-run*-raw.jsonl`, `e3-run*-raw.jsonl`), step batches (`e*-steps-*.json`), flows ground truth (`e1-flows.json`, `e2-before/after-flows.json`, `e4-*-flows.json`), renders (`e1-render-*.png/svg`, `e2-*-render.png`, `e3-loop-*.png`, `e3-svg-*.png`, `e4-*.png`), live-editor ground truth (`e1-editor{,-wide}.png`, `e2-{before,after}-editor{,-wide}.png`, `e3-editor{,-wide,-left,-right}.png`), probes (`e2-probe-*.json`, `e4-probe.mjs`, `e4-lint-scores.json`), guide/plan captures (`e1-guide-methodology.json`), and out-of-band scripts (`e2-oob-finish.mjs`, `e1-gen-steps3.mjs`, `e2-build-mess.py`).

### Ledger triage (rule: nothing stays untriaged)

Buckets per playbook: **validator** rule / **schema** field (tool-surface contract) / **nudge** / **template** / **doc** / **wontfix**. Entries marked **†** are code defects; the bucket shown is the guard/regression artifact the entry becomes — the code fix itself is tracked via §4/§6.

**e1 (15):** 1 guide layout-silent → **doc** (+R6 content) · 2 plan_flow no spatial plan → **schema** (R6/R1) · 3 no node-dims/fit-preview tool → **schema** · 4 width model vs editor → **validator†** (editor-true metrics + fidelity test, R3) · 5 remove_node silent no-op stages → **validator†** (stage-time no-op refusal, R5) · 6 cross-process stage + force_takeover lore → **doc** (+schema auto-clear, R5) · 7 comments write-only → **schema** (R5) · 8 group geometry frozen → **schema** (R5) · 9 mqtt-broker junk fields → **schema†** (D9) · 10 source_node_id runtime-ids-only → **schema** · 11 x≤1300 infeasible / viewport math → **validator** (width-overflow lint, R4) + **doc** · 12 comment anchor / truncation / qlmanage crop → **doc** (recipe) + **validator†** (renderer fidelity, R3) · 13 debug buffer lazy → **doc** (+† subscribe-on-target) · 14 single-slot doubles every op → **schema** (D2/R5) · 15 out-of-band surgeries required → **schema** (R5).

**e2 (14):** 1 probes spatially blind → **validator** (R4 into read surface) · 2 explain_flow junction edges → **validator†** (traversal fix + test) · 3 cross-tab id collision → **schema†** (deriveId fix + exposed key, R5) · 4 diagnostics dropped at transport → **schema†** (R5) · 5 junctions unaddressable / silent no-op → **schema†** (R5) · 6 ~6 calls/node → **schema** (D2/R5) · 7 stagedHash vs staged_hash → **schema** (R5) · 8 process-pinned staging → **doc** + **schema** · 9 auto-fit sibling overlap, no group tools → **schema** (R5) + **validator** (group-overlap incl. groups, R4) · 10 debug WS lazy → **doc** · 11 junction rendered as grey box → **validator†** (R3) · 12 \_authoringKey stamping / key-order churn → **wontfix** (recorded; cosmetic, diff tooling should be order-insensitive) · 13 driver SIGPIPE → **wontfix** (harness fault, recorded) · 14 positives (adoption, snap, diffs, byte-identical wiring) → **wontfix** (no action — credit; retained as regression canaries).

**e3 (8):** 1 loop 13 vs ≤6 → **schema** (D5/R3) · 2 source_tab_id/node_key vocabulary → **schema** (rename/alias) + **nudge** (param-mapping hint) · 3 qlmanage square crop → **doc** (kill the recipe; superseded by R3) · 4 converter roulette undocumented → **doc** · 5 editor-capture viewport + Read downscaling → **doc** · 6 $PREV poisoning after failed call → **nudge** (structured failure payload) · 7 bbox-overlap caught defect blind → **wontfix** (credit) · 8 staging spine clean, hash-identical restore → **wontfix** (credit).

**e4 (9):** 1 no flows.json→layout entry point → **schema** (future layout_flow contract, R2) · 2 ELK junction crash → **validator†** (engine prerequisite + regression test, R2) · 3 dagre strands junction (0,0) → **validator†** (R2) · 4 comments piled at origin → **validator†** (comments as layout participants, R2) · 5 groups unmodeled → **validator†** (compound layout, R2) · 6 qlmanage/magick failures → **doc** · 7 negative group coords; off-canvas skips groups → **validator** (extend off-canvas to groups/comments, R4) · 8 renderer drops junction-out wires → **validator†** (R3) · 9 port order unmodeled; affirmative-on-top inverted → **validator** (port-order lint, R4) + **validator†** (FIXED_ORDER engine prerequisite, R2).

### Judge disagreement notes

- Cold-read/conventions (4–4.5) vs friction (1–2.5) is not a contradiction: pixels pass, path fails; per EVALUATION.md:25 the friction verdict governs the product grade.
- F10 severity contested (one vote: medium — documented roadmap, manual path met the bar in-audit). Kept high: the manual path's cost is precisely what fails the gates.
- F12 severity contested (one vote: medium — loud trap, path unused in recorded runs). Downgraded to medium in this report.
- F3 one judge calibrated high vs critical (wire-origin order survives the port collapse). Reported critical: the check it blinds is the audit's signature criterion.

_Privacy note: all artifacts are sterile-stack only (localhost:1880/1883); no production hosts touched; no git mutations performed by any audit agent._
