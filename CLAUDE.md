# CLAUDE.md

FlowOtter (`@jp5lab/flow-otter`) is an MCP server that lets AI agents safely author,
validate, diff, deploy, and roll back Node-RED flows through a typed authoring layer —
the safety spine (idempotent compilation, snapshot-before-deploy with hash-drift
refusal, tiered env-gates, read-only default) is the whole point and must never
regress. TypeScript ESM, Node ≥20, 75 MCP tools (21 default-visible) behind
progressive-disclosure
toolsets. It deliberately sits at the workspace root outside the bucket layout; the
v2.0.0 release was cut locally on 2026-07-06 after the FULLY FIXED declaration,
and is awaiting the user's push/publish.

## Commands

```bash
npm run build            # rm dist + tsc; .mcp.json and eval drivers run dist/, so rebuild before either
npm run typecheck && npm run lint && npm run format:check
npm test                 # vitest unit+property (also test:unit / test:property)
npm run test:integration # needs the sterile stack: docker compose -f deploy/docker-compose.yml up -d  (localhost:1880)
npm run dev              # tsx bin/flow-otter.ts (stdio MCP server)
```

Per-commit gate ladder: typecheck / lint / format / tests / build / tool-coverage
(`scripts/check-tool-coverage.mjs`) — see `docs/DESIGN.md`.

## Eval gates (all target the Docker sterile stack — NEVER a real runtime)

- `npm run eval:canary` — the safety-spine gate (S4 drift-refusal/rollback/read-only/
  elicitation-decline + S1 author-loop idempotency, exact pinned budgets). Run after
  **every** fix batch before calling it done; any failure blocks everything else.
- `npm run eval:s5` — the audit's headline gate: see-judge-adjust visual loop in
  **≤6 total invocations, 0 failed**, plus ±2px live-editor fidelity. Declaring it
  passed requires two consecutive scripted passes + one live unscripted session.
  Do not loosen the budget. Prerequisite: `npm run fidelity:editor` green.
- `npm run fidelity:editor` — headless-editor geometry vs `renderGeometry`, ±2px.
  Chrome-dependent legs are env-gated behind `FLOWOTTER_LIVE_EDITOR=true`.
- Budgets/steps files are pinned by unit tests (`tests/unit/scripts/eval/`) —
  loosening a gate is intentionally loud. Protocol: `docs/EVALUATION.md`.

## Current state (2026-07-06 release cut)

The 2026-06-10 layout-audit fix campaign is complete. FULLY FIXED was declared
2026-07-06 at commit `a5b634d` per `scripts/eval/replay/AUDIT-RERUN.md`; the
sanitized public record is `docs/audits/2026-07-06-audit-rerun.md`. The v2.0.0
release cut remains local and unpushed per house rules. `eval-results/2026-06-10-layout-audit/BACKLOG.md`
remains the detailed local record; do not force-add `eval-results/`.

## House rules

- **Never push** — the user pushes/publishes. Commit locally as the JP5Lab identity.
- **Public repo hygiene**: run `npm run privacy:scan:staged` before every commit.
  `eval-results/` and root `/flows.json` are gitignored because they can carry real
  broker hosts/URLs — never force-add them.
- `.mcp.json` registers this repo's own built server (`dist/bin/flow-otter.js`,
  `FLOW_SOURCE=file`, `READ_ONLY_MODE=true`) into every session here — a stale
  `dist/` means you're dogfooding old code.

Docs: `docs/ARCHITECTURE.md` (write pipeline), `docs/TOOL_REFERENCE.md`,
`docs/DESIGN.md` (strategy + phase gates), `docs/NON_GOALS.md`, `docs/AGENT_QUICKSTART.md`.
