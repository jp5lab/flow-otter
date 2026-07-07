# FlowOtter

**An MCP server that lets AI agents author Node-RED flows a plant operator can read.**

Most agent-authored Node-RED flows are functionally correct and visually unreadable: nodes piled in a column, error paths woven through the happy path, wires running backward, groups that contain nothing. FlowOtter's headline is **operator-legible layout**: signal lifecycle left-to-right, lifecycle stages grouped with headers, error lane below the happy path, affirmative switch output on top, minimal crossings, no backward wires, grid-aligned within the visible viewport.

The floor underneath that is a safety spine that must not regress: byte-identical idempotent compilation, snapshot-before-deploy with hash-drift refusal, tiered env gates with read-only as the default, and rollback proven byte-identical. Layout is the headline; safety is the floor.

FlowOtter v2.0.0 ships 75 registered MCP tools with a 21-tool default-visible surface. `spec_authoring` and `layout` are default-on; demoted toolsets stay callable through the v2 deprecation window.

## The Before/After Story

FlowOtter ran a full adversarial layout audit against itself on 2026-06-10 against a sterile Node-RED 4.1.11 stack. The sanitized report is committed at [docs/audits/2026-06-10-layout-audit.md](docs/audits/2026-06-10-layout-audit.md). The verdict was honest: the final screens passed the operator bar, but only because the agent acted as its own layout engine. The toolchain blew every budget the project sets for itself.

The 2026-07-06 audit re-run declared the fix campaign **FULLY FIXED** at commit `740dd5d`. The committed summary is [docs/audits/2026-07-06-audit-rerun.md](docs/audits/2026-07-06-audit-rerun.md): all gates green twice where required, friction 4.5, blind judges e1 4.5/4.0 after capture-parity correction, e2 4.5/4.0, and S6 scored benchmark passing with frozen thresholds (`e1 0.9333 -> 0.9333`, `e2 0.6084 -> 1.0000`).

| Task                                    | Audit (v1.3.0, measured)                                                               | Gate now (v2.0.0, enforced)                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| See-judge-adjust visual loop (S5)       | 13 total invocations as executed; agent could not view its own render                  | **5/6 total invocations, 0 failed**, rendering staged state, plus live-editor fidelity at +/-2px (`npm run eval:s5`)                                               |
| Reorganize a 12-node spaghetti tab (e2) | 79 total audit invocations, 12 confirmations, 22 failed calls, 2 out-of-band surgeries | **4 MCP calls + 1 confirmation**, 0 failed, 0 forced, 0 out-of-band, wiring byte-identical (`npm run eval:replay -- --scenario e2 --phase 1`)                      |
| Greenfield 14-node flow (e1)            | 278 calls, 49 confirmations, 158 failed calls                                          | Phase 1 replay: **10 MCP calls, 3 confirmations, 0 failed**; Phase 2 `stage_spec`: **3 MCP calls, 0 confirmations, 0 failed**                                      |
| Renderer vs. the real editor            | Three disagreeing geometries; widths off by 37-53px/node                               | **+/-2px** per-corner and per-port-center against a live headless editor (`npm run fidelity:editor`)                                                               |
| Layout conventions reaching the agent   | Zero MCP channels carried them                                                         | Taught in-band with numbers: 20px grid, 140-220px column pitch, error lane >=120px below, port 0 on top, <=1420px viewport                                         |
| Safety spine under abuse                | Zero data loss across 362 calls and 65 deploys                                         | Standing canary (`npm run eval:canary`): drift refusal, byte-identical rollback, read-only tier enforcement, elicitation-decline abort, and idempotent author loop |

The budgets are not aspirations. They are committed steps files with exact numbers, pinned by unit tests so loosening a gate is loud, and re-run against the sterile Docker stack. "It worked eventually" is scored as a failure when the budget blew; that rule is in [docs/EVALUATION.md](docs/EVALUATION.md).

## Why Not Just...

|                                                                             | Raw `flows.json` editing | Generic filesystem/HTTP MCP access | Typical Node-RED admin-API wrapper or `node-red-contrib-*` automation |
| --------------------------------------------------------------------------- | ------------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| Idempotent authoring: same intent twice -> byte-identical flows, stable IDs | No, IDs drift every run  | No                                 | Rarely; ID management is the caller's problem                         |
| Validation before deploy                                                    | None                     | None                               | Usually deploy-then-see                                               |
| Snapshot before every deploy + one-call rollback                            | Manual                   | Manual                             | Sometimes snapshots, rarely drift-aware                               |
| Refuses to deploy over concurrent out-of-band edits                         | No                       | No                                 | No                                                                    |
| Read-only by default; write/deploy/dangerous tiers env-gated                | No                       | No                                 | No                                                                    |
| Agent can see the flow as a PNG, including staged state                     | No                       | No                                 | No                                                                    |
| Layout conventions taught in-band + scored layout lint                      | No                       | No                                 | No                                                                    |
| Renderer verified against the real editor (+/-2px)                          | n/a                      | n/a                                | No                                                                    |
| Human-consent elicitation on deploy                                         | No                       | No                                 | No                                                                    |

The point is not that these alternatives are broken. It is that each leaves the safety and legibility burden on the agent, and agents demonstrably drop it. FlowOtter moves that burden into a typed authoring layer with gates.

## Five-Minute Quickstart

Requires Node >=20 and Docker for the local test stack.

```bash
# 1. Build
git clone https://github.com/JP5Lab/flow-otter.git
cd flow-otter
npm install
npm run build

# 2. Start a sterile Node-RED to play against
docker compose -f deploy/docker-compose.yml up -d
```

Register the built stdio server with your MCP client:

```json
{
  "mcpServers": {
    "FlowOtter": {
      "command": "node",
      "args": ["/absolute/path/to/flow-otter/dist/bin/flow-otter.js"],
      "env": {
        "NODE_RED_BASE_URL": "http://localhost:1880",
        "READ_ONLY_MODE": "false",
        "ENABLE_WRITE_TOOLS": "true",
        "ENABLE_DEPLOY_TOOLS": "true"
      }
    }
  }
}
```

Ask your agent something like:

```text
Build me an MQTT alarm flow: subscribe, debounce, threshold-switch, notify. Lay it out so an operator can read it and show me the PNG before deploy.
```

The agent can plan, stage, render the staged change as a PNG, adjust, and ask for consent before anything touches the runtime. Every deploy snapshots first; `rollback_last_change` restores byte-identically. Leave all write/deploy env flags off and FlowOtter is a read-only analysis/rendering surface.

Supported Node-RED: 4.0 minimum, 4.1.x recommended, 5.0 GA supported.

## Safety Model

| Env var                             | Default | Effect                                                        |
| ----------------------------------- | ------: | ------------------------------------------------------------- |
| `READ_ONLY_MODE`                    |  `true` | Blocks all write/deploy/dangerous tiers.                      |
| `ENABLE_WRITE_TOOLS`                | `false` | Enables author/stage tools when read-only is off.             |
| `ENABLE_DEPLOY_TOOLS`               | `false` | Enables deploy/rollback when write tools are enabled.         |
| `ENABLE_DANGEROUS_TOOLS`            | `false` | Enables destructive full replace/delete/reset tools.          |
| `REQUIRE_DRIFT_CHECK_BEFORE_DEPLOY` |  `true` | Refuses staged deploy if the runtime hash changed underneath. |

Every deploy and dangerous operation snapshots the prior runtime first. The drift check, rollback byte-identity, read-only tier, and consent-decline abort are not documentation claims; they are the standing canary gate.

## Docs

- [Agent Quickstart](docs/AGENT_QUICKSTART.md) - how an AI agent drives FlowOtter
- [Tool Reference](docs/TOOL_REFERENCE.md) - every tool, signature, example
- [Architecture](docs/ARCHITECTURE.md) - layer boundaries and the write pipeline
- [Evaluation Playbook](docs/EVALUATION.md) - gates, budgets, and counting rules
- [Layout Audit (2026-06-10)](docs/audits/2026-06-10-layout-audit.md) - the before story, published warts and all
- [Audit Re-run (2026-07-06)](docs/audits/2026-07-06-audit-rerun.md) - the FULLY FIXED declaration summary
- [Design & Roadmap](docs/DESIGN.md)
- [Non-Goals](docs/NON_GOALS.md)
- [Changelog](CHANGELOG.md)

## License

Mozilla Public License 2.0 - see [LICENSE](LICENSE).
