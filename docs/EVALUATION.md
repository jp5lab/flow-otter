# Evaluation Playbook

FlowOtter is "working as expected" only when a real agent session, driving the
real MCP surface against a real Node-RED runtime, produces a flow that **works**
and **reads well in the editor** — within a measured friction budget. This
playbook defines the loop that proves that, scenario by scenario, and the
hygiene gate that keeps this public repository free of private data.

It complements the per-commit verification gates (typecheck / lint / format /
tests / build / tool-coverage, see `docs/DESIGN.md`): those prove the
code is sound; this proves the _product_ is usable. Strategy context lives in
`docs/DESIGN.md` — its phase gates reference the scenarios
below.

## Principles

1. **Evaluate through the surface users hold.** Scenarios are driven by an AI
   agent over MCP (stdio), not by direct toolkit calls. Unit tests already
   cover the toolkit; this loop covers the agent experience.
2. **Sterile runtime only.** All evaluation targets the Docker stack in
   `deploy/docker-compose.yml` (`localhost:1880`). Never point an evaluation
   session at a production or personal runtime — both for safety and because
   sterile-stack artifacts are the only ones safe to publish.
3. **Quantify friction.** Every run records tool-call count, deploy-confirmation
   count, retries, and wall time. "It worked eventually" is a fail if the
   budget blew.
4. **Failures feed the knowledge layer.** Every "the agent still had to know X"
   moment is logged verbatim in the run ledger and triaged into a validator,
   schema field, nudge, template fix, or documented limitation — the same
   honest register as the README showcase.
5. **Results stay local.** Raw run records live in `eval-results/` (gitignored —
   they may contain real target URLs from misconfiguration). Only sanitized
   summaries and sterile-stack screenshots are ever committed.

## Environment

```bash
docker compose -f deploy/docker-compose.yml up -d   # Node-RED + Mosquitto
npm install && npm run build                        # MCP client runs dist/
```

- **Version matrix:** run the suite against Node-RED 4.1.x (maintenance line)
  and 5.0.x (GA since 2026-06-09) by switching the compose image tag.
- **Fresh state per run:** use a distinct `ENVIRONMENT_NAME=eval-<scenario>-<n>`
  per run so snapshots/staging/audit don't cross-contaminate; delete
  `~/.flow-otter/eval-*` between campaigns.
- **Tier flags per scenario:** default read-only; enable
  `ENABLE_WRITE_TOOLS` / `ENABLE_DEPLOY_TOOLS` / `ENABLE_DANGEROUS_TOOLS`
  only where the scenario calls for them.
- After any rebuild, restart the MCP client session — the client launches
  `dist/bin/flow-otter.js` at session start.

## Scenario suite

| ID  | Name                  | What it proves                                       | Tiers        | Pass criteria                                                                                                                                                                                                                  |
| --- | --------------------- | ---------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S0  | Smoke                 | Server boots, targets the stack, detects version     | read         | `health_check` reports runtime version + capability matrix correctly for the matrix leg under test                                                                                                                             |
| S1  | Author loop           | README Tab-1 claim: full common-author-tools tab     | write+deploy | Deploys clean; `validate_flow` clean; re-running the same session prompt produces byte-identical `flows.json` (idempotency); budget recorded                                                                                   |
| S2  | Dashboard composition | README Tab-2 claim: 6 templates, one shared skeleton | write+deploy | `/dashboard` renders; ISA-101 + hierarchy validators clean; runtime accepts every widget (no editor crash, no runtime reject)                                                                                                  |
| S3  | Topology              | README Tab-3 claim: subflow + cross-tab links        | write+deploy | Links resolve; subflow instance consistent after redeploy                                                                                                                                                                      |
| S4  | Safety drills         | The differentiator never regresses                   | all          | Out-of-band runtime mutation → staged deploy **refuses** (drift); `rollback_last_change` restores byte-identical snapshot; elicitation decline aborts deploy; read-only blocks writes; dangerous tools absent without env flag |
| S5  | Visual loop           | Phase-0 gate of the strategy                         | write        | Agent stages a change, renders, _sees_ the result (PNG), adjusts, re-renders — in ≤ 6 tool calls, and its visual judgment matches what the editor shows                                                                        |
| S6  | Layout benchmark      | Phase-2 gate of the strategy                         | toolkit      | 10–20 exemplar community flows, positions stripped, re-laid-out: layout-lint score vs. originals + human eyeball verdict per flow                                                                                              |
| S7  | Cold-agent discovery  | Server is self-teaching                              | read         | A fresh agent with no priming (only server instructions + prompts) finds `get_authoring_guide`/`plan_flow` and follows the methodology unprompted                                                                              |

Scenario prompts are written down verbatim in the run record so runs are
comparable across versions. S1–S3 reuse the README showcase prompts — every
README claim must stay reproducible, or the README changes.

## Run record and ledger

One file per run: `eval-results/<date>-<scenario>-<n>.md` containing:

- FlowOtter version + commit, Node-RED version, agent/client + model
- Pass/fail per criterion
- **Budget:** tool calls, deploy confirmations, retries, wall time
- Validator/lint output deltas
- **Ledger:** verbatim "what the agent still had to bring" entries
- Artifact paths (rendered SVG/PNG, exported flows.json)

Ledger triage (do this while it's fresh): each entry becomes a validator rule,
a schema field, a nudge, a template fix, a skills/doc line, or a recorded
wontfix — nothing stays untriaged.

## Iteration protocol

1. Run a scenario → score it.
2. File each finding (public-safe wording) as an issue/work item with severity.
3. Fix.
4. Re-run the scenario until it passes **twice consecutively** (flake guard).
5. After any fix batch, re-run S4 (safety) and S1 (regression canary) before
   calling the batch done — safety regressions block everything else.
6. Run the standard verification gates before commit, plus the hygiene gate
   below if the change touched docs, fixtures, examples, or screenshots.

## Phase gates (strategy linkage)

- **Phase 0 exit:** S5 passes — the PNG loop is ergonomically real, not asserted.
- **Phase 1 exit:** S1 passes within the spec-authoring budget (target: ≤ 3
  authoring calls + 1 deploy confirmation for a ~15-node flow via `stage_spec`)
  and S4 stays green.
- **Phase 2 exit:** S6 meets its threshold (set after the first benchmark run,
  then frozen) **and** S2/S3 stay green with auto-layout applied. Auto-layout
  does not become a default anywhere before this gate passes.

## Driving the loop with an AI agent

- The project-scoped `.mcp.json` registers the built server automatically for
  agent clients that open this repo.
- One scenario per agent session keeps budget accounting clean.
- **Parallel evaluation caveat:** staging holds one pending change per
  environment. Parallel sessions need distinct `ENVIRONMENT_NAME`s _and_
  distinct Node-RED targets (e.g. compose project copies on different ports) —
  otherwise run scenarios sequentially. See `docs/ARCHITECTURE.md`.
- Orchestrated runs (subagent fan-out) are fine for _scoring and analysis_;
  the tool-driving session against a single runtime stays sequential.

## Public-repo hygiene (the privacy gate)

This repository is developed on personal workstations but published publicly —
GitHub **and** npm (`files` ships `docs/` in the tarball, so docs hygiene is
release hygiene). The gate:

1. **`npm run privacy:scan`** — scans tracked + untracked-unignored text files
   for private-information patterns (LAN addresses, home-directory paths,
   emails, tokens, MAC addresses, mDNS hostnames). Non-zero exit blocks.
2. **`npm run privacy:scan:history`** — sweeps every added line in the full git
   history. Run before tagging a release and after importing any large doc.
3. **Local pre-commit hook** (recommended): runs the staged-diff scan on every
   commit. Install once:

   ```sh
   printf '#!/bin/sh\nnode scripts/privacy-scan.mjs --staged\n' > .git/hooks/pre-commit
   chmod +x .git/hooks/pre-commit
   ```

4. **Personal patterns stay out of the repo.** The shipped scanner contains
   only generic pattern classes. Each maintainer keeps their own identifiers
   (usernames, real subnets, hostnames) in `~/.flow-otter/privacy-patterns.txt`
   (one regex per line) — the scanner picks it up automatically. Never commit
   that file or paste its contents into an issue: a public deny-list would
   itself be the leak.
5. **Placeholder conventions** for docs and fixtures: the established generic
   examples `192.168.1.10/.20/.30`, `factory-line-a`, `home-automation`, or the
   RFC 5737 documentation ranges (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`)
   and `example.com`. The allowlist (`scripts/privacy-allowlist.txt`) holds
   exactly these sanctioned values plus the exact fake credentials used by
   redaction tests — never allowlist real data to silence a finding; remove
   the data instead.
6. **Screenshots are content.** Only capture the sterile localhost stack; crop
   browser and OS chrome (URL bar beyond localhost, bookmarks, avatars, menu
   bar); inspect each image — including PNG text-chunk metadata — before
   committing. The scanner skips binaries and says so; images are reviewed by
   eye (or agent vision) instead.
7. **Build artifacts:** `dist/` is gitignored; it ships to npm via `prepack`
   rebuild. TypeScript source maps emit relative paths (verified) — if build
   tooling ever changes, re-check `dist/**/*.map` for absolute paths before
   publishing.
8. **Commit identity:** commits must use the repo-local public alias (the
   `JP5Lab` noreply identity), not a personal global git config. Verify with
   `git config user.name` inside the repo after cloning to a new machine.
