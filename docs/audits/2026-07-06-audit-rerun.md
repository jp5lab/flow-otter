# FlowOtter Audit Re-run — FULLY FIXED Declaration

**Audit question:** After the 2026-06-10 layout audit found FlowOtter's final screens readable but its toolchain over-budget, can the fixed v2 surface produce operator-legible Node-RED layouts within the committed budgets, with the safety spine still intact?

**Subject:** FlowOtter fix-campaign tree at declaring commit `a5b634d` (`a5b634d42463d1db516ec299d45553663b774362`), evaluated before the v2.0.0 release version bump. Date: 2026-07-06. Runtime: sterile Node-RED 4.1.11 + Mosquitto Docker stack. No real runtime was touched.

**Protocol:** `scripts/eval/replay/AUDIT-RERUN.md`, sha256 `2ca25e1923020eb9d3fc49bf1f6a7882fc2ef77b5818a1046804d385530ce12c`.

**Frozen S6 contract:** `eval/benchmark/thresholds.json` sha256 `e61d7bb58d94ccebf7915a6e6f0cdaff49ec8272d25183ab20070231458d2380`; `eval/benchmark/PROTOCOL.md` sha256 `dc29a8d4047a3de2ce48fe8398b617c1d95a826a8419e70fb100207cdb0103a9`.

---

## Executive Verdict

**FULLY FIXED.**

Every required mechanical gate passed at the declaring commit, twice consecutively where the protocol requires it, with **0 failed calls, 0 forced deploys, 0 takeovers, 0 out-of-band mutations, and 0 budget violations**. The safety spine had zero regressions. The scored S6 benchmark passed with the frozen thresholds untouched. Blind judges scored the final e2 replay at 4.5 cold-read / 4.0 conventions, and the final e1 replay at 4.5 / 4.0 after the capture-parity correction described below.

## Mechanical Gate Matrix

| Gate                       | Bar                                                                         | Actual Account                                                                                                                                                                                                                                 | Verdict        |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Static + repo gates        | typecheck, lint, format, tests, build, tool coverage, privacy all green     | `typecheck`, `lint`, `format:check`, `test:unit` (175 files, 1549 pass, 1 skip), `test:property` (28 pass), `test:integration` (135 pass, 3 skip), `build`, tool coverage (75 tools, 0 missing), privacy worktree + history scans (0 findings) | PASS           |
| `eval:canary` safety spine | Two consecutive passes; no safety regressions                               | Both runs: 31 MCP calls, 0 failed, 15 deploy confirmations, 0 force, 0 takeovers, 0 OOB, `budget_violations=[]`; S4 drift/rollback/read-only/decline and S1 idempotency all PASS                                                               | PASS x2        |
| `fidelity:editor`          | Live editor geometry within +/-2px                                          | Node-RED 4.1.11 fixture freshness exact; 20 entries, 80 corners, 22 ports checked at +/-2px                                                                                                                                                    | PASS           |
| `eval:s5` see-judge-adjust | Loop <=6 total invocations, 0 failed; scripted x2 plus live session         | Scripted runs: loop 3 MCP + 2 exec = 5/6, 0 failed, 0 force, 0 OOB, fidelity PASS. Live session: 3 MCP + 2 Read = 5/6, 0 failed, fidelity PASS                                                                                                 | PASS x2 + live |
| `eval:replay` e2 phase 1   | Pure-MCP <=5 calls + 1 confirmation, 0 failed, 0 OOB, wiring byte-identical | Budgeted authoring section: 4 MCP calls + 1 confirmation; 0 failed, 0 force, 0 OOB; wiring-map byte-identical to seeded baseline                                                                                                               | PASS x2        |
| `eval:replay` e1 phase 1   | <=30 MCP calls, <=3 confirmations, 0 failed                                 | 10 MCP calls, 3 confirmations, 0 failed; post-conditions PASS                                                                                                                                                                                  | PASS x2        |
| `eval:replay` e1 phase 2   | Zero-coordinate `stage_spec` path, no expected-fail escape                  | 3 MCP calls, 0 confirmations, 0 failed; `layout_computed:true`; idempotence hash stable across attempts                                                                                                                                        | PASS x2        |
| `eval:s6 -- --scored`      | Frozen thresholds pass; not-worse rate 1; zero crashes; semantics pass      | Both runs: `verdict: PASS`, `not_worse_rate=1`, `crashes=0`, `semantics_pass_all=true`; threshold/protocol shas matched                                                                                                                        | PASS x2        |
| Friction score             | >=4                                                                         | All phase budgets met; no failed/OOB/force/budget violations; mechanical 5 with discretion band +/-0.5, worst case 4.5                                                                                                                         | PASS           |

## S6 Scored Benchmark

Both scored runs were identical:

| Flow                          |  Baseline lint |    Layout lint |           Delta | Verdict                   |
| ----------------------------- | -------------: | -------------: | --------------: | ------------------------- |
| audit-2026-06-10-e1, legs A/B | 0.933333333333 | 0.933333333333 | +0.000000000000 | not worse, semantics pass |
| audit-2026-06-10-e2, legs A/B | 0.608391608392 | 1.000000000000 | +0.391608391608 | improved, semantics pass  |

The runner verified both the frozen thresholds hash and benchmark protocol hash before scoring. No superseded-thresholds escape was used.

## Judge Panel

Bar: each scenario must hold >=4 on cold-read and conventions against the original audit anchors.

### Round 1

| Scenario | Cold-read | Conventions | Verdict |
| -------- | --------: | ----------: | ------- |
| e1       |       3.0 |         3.0 | FAIL    |
| e2       |       4.5 |         4.0 | PASS    |

Round 1 remains on record. The e1 failure was driven by the capture itself: the replayed screenshot was taken at 1600px against a 2200px-wide anchor, clipping both the left ACQUIRE edge and downstream DECIDE/ACT/INDICATE path. Judges also found a real product gap: spec-authored comments could not declare header-to-group association, so headers floated detached from the groups they described.

Anchor integrity note: the named e1 anchor image from the original audit artifact set was corrupted, so judges calibrated against the wide e1 anchor and e2 anchor from the same audit set. This deviation is recorded here rather than hidden.

### Round 2

The capture-parity flaw was corrected by judging e1 at the anchor's 2200px width. The header association product gap was fixed in the declaring commit by adding comment-level `headerFor` support to `stage_spec` / `validate_spec`, threading it through `CommentSpec`, two-level layout, and compiled `_authoringHeaderFor`. The affected replay leg re-passed twice at `a5b634d`.

| Scenario | Cold-read | Conventions | Verdict |
| -------- | --------: | ----------: | ------- |
| e1       |       4.5 |         4.0 | PASS    |
| e2       |       4.5 |         4.0 | PASS    |

The e1 Round-2 capture was geometrically indistinguishable from the hand-arranged 4.5/4.0 anchor. Residual deductions matched the anchor-level imperfections: left-edge ACQUIRE clipping, several detached stage headers, and one long unrouted diagonal wire. Those residuals did not block the >=4 bar.

## Methodology Notes

- The declaration rests on committed steps, budgets, threshold files, and run verdicts, not on manual judge sympathy.
- The zero-coordinate disqualification rule was active for e1 phase 2 and S6 leg B: position-bearing payloads in layout-computed sections abort before any tool call.
- S5 required both scripted regression passes and a live unscripted session; the scripted gate alone was not treated as sufficient.
- Round-1 e1 scores remain part of the record. Round 2 is the panel of record for the e1 lens bars at the declaring commit because it corrected a capture-parity flaw and incorporated the headerFor fix that re-passed the mechanical replay gate.

## Verdict Line

**FULLY FIXED declared 2026-07-06 at commit `a5b634d`: all required gates green, pinned budgets and frozen thresholds untouched, safety spine intact.**
