# AUDIT-RERUN — the FULLY FIXED re-run protocol (EVAL-6)

Provenance: the 2026-06-10 layout audit (`docs/audits/2026-06-10-layout-audit.md`)
returned **NOT-YET** — operator-readable layouts only at agent-as-layout-engine
prices, with the safety spine as the one unqualified credit. The ratified fix
plan (`docs/plans/2026-06-10-fix-plan.md`, §1) defines when that verdict flips
to **FULLY FIXED**. This file is the operating procedure for declaring it.
EVAL-5's replay runner (`replay.mjs`, Phase 2) lands in this directory.

## What FULLY FIXED means (mechanical anchors)

FULLY FIXED is declared only when an audit re-run passes **ALL** of the
following. Every bar is anchored to a mechanical account — committed steps
files, the driver's per-section budget counters, sha256-frozen thresholds —
**not** to judge sympathy.

| Criterion                | Bar                                                                             | Mechanically derived from                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friction                 | ≥ 4                                                                             | The EVAL-1 budget account: all phase budgets met, 0 failed calls, 0 OOB mutations, 0 `force` — judge discretion ±0.5 only                                                                   |
| Cold-read + conventions  | ≥ 4 each, held                                                                  | Fresh non-author judges, the audit rubric, with the audit's original editor screenshots (`e1-editor.png` / `e2-after-editor.png`, the 4.5/4 anchors) as the comparison baseline             |
| S5 see-judge-adjust loop | ≤ 6 **total** invocations (MCP + Read/exec), ±2px live-editor fidelity          | `npm run eval:s5`, twice consecutively, **plus one live unscripted session** (see below)                                                                                                    |
| S6 layout benchmark      | Pre-registered thresholds pass, **both legs** (stripped + zero-coordinate spec) | `eval:s6 --scored` against the sha256-frozen `thresholds.json` (EVAL-3/EVAL-4)                                                                                                              |
| e2 replay                | Pure-MCP ≤ 5 calls + 1 confirmation, 0 failed, 0 OOB, wiring byte-identical     | `eval:replay --scenario e2 --phase 1` (EVAL-5)                                                                                                                                              |
| Repo gates               | All green                                                                       | typecheck / eslint / prettier / full unit+property+integration suites at the declaring commit / build / tool-coverage / privacy-scan (counts recorded in the run file — they grow per item) |
| Safety spine             | Zero regressions                                                                | `npm run eval:canary` (S4 drift-refusal/rollback/decline/read-only drills + S1 idempotency) after every fix batch; twice-consecutive rule for every gate declaration                        |

The friction score derives from the budget account — the committed budgets in
the steps files are the numbers of record (see "Committed numbers" below).

## Gate runners (committed, falsifiable forms)

| Gate                          | Command                        | Status                    |
| ----------------------------- | ------------------------------ | ------------------------- |
| Safety-spine canary (S4 + S1) | `npm run eval:canary`          | landed (EVAL-6)           |
| S5 see-judge-adjust loop      | `npm run eval:s5`              | landed (EVAL-2)           |
| Renderer-fidelity floor       | `npm run fidelity:editor`      | landed (REND-7)           |
| e2 / e1 replay scenarios      | `eval:replay` (this directory) | EVAL-5 — Phase 2          |
| S6 scored benchmark           | `eval:s6 --scored`             | EVAL-3/EVAL-4 — Phase 2/3 |

## The zero-coordinate disqualification rule

The e1-phase2 replay leg and **all** S6 leg-B specs must be **mechanically
position-free**. Their steps files run with the relevant sections flagged
`layout_computed: true`, which arms the driver's anti-gaming lint: any
tool-call payload carrying `position` keys or numeric `x`/`y` fields aborts
the run (exit 2) **before any call is made**.

> **A hand-placed spec disqualifies the run.** No judge discretion, no
> partial credit, no "the layout was good anyway". This closes the audit's
> agent-as-its-own-layout-engine gaming path: for these legs, layout quality
> must come from the machine or the run does not count.

(S1 and S5 are deliberately **not** `layout_computed` — agent-supplied
positions are those scenarios' point at HEAD.)

## Live-session confirmation is binding

For S5/S7-class gates — any gate whose claim is about **ergonomics** (an
agent can actually work this way), not just mechanics:

- the **scripted run is the standing regression** — cheap, per-batch,
  falsifiable, immune to nostalgia;
- the **live unscripted session is the ergonomic proof** — a real agent
  client, no steps file, transcript showing the loop within the same budget
  the scripted run enforces;
- **both are required** to declare the gate; neither substitutes for the
  other. A scripted pass with no live session is "mechanism exists"; a live
  pass with no scripted pin is "it worked once".

Both are recorded in run files (below).

## Per-batch verification protocol

1. **After any fix batch:** `npm run eval:canary` must pass before the batch
   is called done — safety regressions block everything else. The S4 legs
   are pinned **credits** (the audit found the spine held; the canary passes
   at HEAD): any future canary failure is a stop-the-line event.
2. **Gate declarations:** twice-consecutive passes, plus the live session for
   S5/S7-class gates.
3. **Committed numbers, not the author's head:** every budget cited in a
   declaration lives in a committed steps file (`scripts/eval/steps/`) or a
   sha256-frozen thresholds file; the run file links them. Changing a number
   means changing the committed file in the same commit — the unit pins on
   the steps files make silent loosening loud.

## Run files

One file per run: `eval-results/<date>-<scenario>-<n>.md` (gitignored; only
sanitized summaries are ever committed — see the hygiene gate in
`docs/EVALUATION.md`). Each records: FlowOtter version + commit, Node-RED
version, agent/client + model, pass/fail per criterion, the budget account
(per-section counters from the driver's `done` line or the runner's `--json`
verdict), validator/lint deltas, ledger entries, and artifact paths. Live
sessions additionally record the transcript reference.

The FULLY FIXED declaration itself cites: the two consecutive scripted passes
(run files) per gate, the live-session run file(s) for S5/S7-class gates, the
`thresholds.json` sha256 (also recorded in the DESIGN.md ratification entry),
and the repo-gate suite counts at the declaring commit.
