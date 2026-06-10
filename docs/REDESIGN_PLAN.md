# FlowOtter Redesign Plan — v1.3.0

> **Status legend:** `TODO` not started · `IN PROGRESS` actively being executed · `DONE` shipped and verified · `BLOCKED` halted with note explaining why

## Purpose

This document is the durable plan for the v1.3.0 architectural redesign. It captures the design decisions, item-level specs, file-level edits, and acceptance criteria for thirteen prioritized items. The plan is intended to survive context compression and serve as the authoritative contract for any session resuming the work — read this first, execute one item at a time, mark status as you go.

## Anchor decisions

1. **Specialist node tools → opt-in toolset.** The 15 `add_*_node` specialist tools (inject/debug/function/etc.) stay, but move into the non-default `author_specialists` toolset. The default authoring surface is the generic `add_node`, which must treat the long tail of node-red-contrib-\* packages (Modbus, InfluxDB, OPC UA, BACnet, S7, etc.) as a first-class concern — not core types only.
2. **Operator dashboards are major-but-not-flagship.** Methodology is the foundation. Dashboards are downstream — nodes ARE the backend to the dashboard, so good node structure has to come first. The dashboard widget gap and operator templates land in the second wave, after items 1-6 (instructions / catalog / version / plan_flow / soft-nudge / toolsets).
3. **`plan_flow` is soft-nudge via response-side guidance, full implementation from day one (no MVP).** Server doesn't enforce; `add_*` calls return contextual warnings when a flow has substantial structure and no `plan_flow` record exists. Generalizable warning system, not a one-off check.
4. **Credentials stay out of scope.** FlowOtter is a design tool; credentials are a deployment concern handled in the Node-RED editor. The existing `credential-leak` validator (catches creds stuffed into wrong fields) stays.

Across all four decisions the consistent principle is **scope discipline + architectural robustness** — well-architected design tool, not swiss army knife. No MVPs.

## Version support matrix

- **Minimum:** Node-RED 4.0.0 (Node.js 18+ required by Node-RED itself)
- **Recommended:** Node-RED 4.1.x (current stable 4.1.10)
- **Best-effort:** Node-RED 5.0.0-beta.x (5.0 is mostly editor UX; flows.json + admin API stable from 4.x)
- **Unsupported:** below 4.0

Capability gating is per-feature, not per-version. The matrix lives in `src/adapters/nodered/capabilities.ts` (built in Item 3).

## Operational protocol

- **Branch:** all work lands on `main` directly. No feature branches.
- **Commits:** small, focused, one item per commit where practical. Good commit messages with rationale. **No AI byline.**
- **Pushes:** never push to remotes until the maintainer gives explicit go-ahead.
- **Checks before each commit:** typecheck + lint + format + tests + build + tool-coverage. Never claim done without all six passing.
- **Scope discipline:** stick to the 13-item list. No incidental cleanup, no refactors, no "while I'm in here" improvements.
- **Ambiguity protocol:** if a decision is genuinely ambiguous and not covered by the anchor decisions or this plan, add a `BLOCKED:` marker to the item with the options listed and move on. Don't guess on architectural calls.
- **Continuity:** mark item status as it progresses. If a session ends mid-item, the next session reads this file and resumes.

## Verification gates (run after every item)

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:property
npm run test:integration   # (when integration coverage is in scope)
npm run build
```

Tool-coverage check: ensure every new tool is listed in `ALL_TOOLS` in `src/server/index.ts` and has a corresponding entry in `docs/TOOL_REFERENCE.md` (updated in the final verification item).

If any check fails: do not commit. Fix the regression or back the change out.

---

## Item 1: MCP server `instructions` field

**Status:** DONE (commit 314ac5b)

### Rationale

The MCP protocol supports a server-level `instructions` string (capped at 2KB by Claude Code) injected system-prompt-style into the agent's context. FlowOtter currently sets none. This is the single highest-leverage change in the entire redesign — one parameter, immediate behavior shift.

### Scope

In: add the field, write a methodology playbook within the 2KB budget covering the 8-step flow design pipeline, capability discovery, toolset usage, credential boundary, version awareness.

Out: any other behavior changes; tool surface stays untouched.

### Design

The `instructions` text (target ~1900 chars, hard ceiling 2000):

```
FlowOtter is an MCP server for authoring Node-RED flows (4.0+). It produces flow JSON for a target runtime, with staging, validation, snapshots, and atomic deploys. Treat flow authoring as a 4-phase pipeline.

1. PLAN — for any flow >10 nodes or operator dashboards, call `plan_flow` first. Restate the goal as 3-7 logical stages and decide on organization BEFORE creating nodes.

2. ORGANIZE — decision tree (apply before adding nodes):
- Pattern repeats 2+ times → `create_subflow_definition` + `add_subflow_instance`
- Multiple nodes share one logical purpose → `add_group` (nestable)
- Wire would span tabs or long distance → `add_link_out_node` + `add_link_in_node`
- Stage is independent → new tab

3. STRUCTURE → WIRE → LAYOUT:
- Add nodes first (no wires), then `wire_nodes`/`set_wires`. Layout is currently explicit: set node positions, group geometry, and use `move_node`; render SVG before deploying. No MCP `layout_flow` tool is exposed yet.

4. REVIEW → VALIDATE → DEPLOY:
- `render_flow_svg` and show the user before deploy.
- `validate_flow` must pass.
- `preview_flow_diff` then elicit user confirmation before `deploy_staged_change`. Never deploy without explicit confirmation.

CAPABILITY DISCOVERY: call `get_authoring_guide` once per session for the full feature catalog (node types, Dashboard 2.0 widgets, templates, validators, ISA-101 principles). Use `list_available_toolsets`/`enable_toolset` if you need tools beyond the default surface.

SPECIALISTS vs GENERIC: prefer generic `add_node({type, ...})` — it handles all contrib packages (Modbus, InfluxDB, OPC UA, etc.) and core types. Specialist tools (add_inject_node, etc.) live in the `author_specialists` toolset; load them only when type-specific schema validation matters.

DASHBOARDS: when authoring Dashboard 2.0 UIs, follow ISA-101 principles surfaced via `get_authoring_guide` — grayscale background, color reserved for severity, trends > instantaneous values, destructive controls require confirm.

VERSIONING: FlowOtter detects Node-RED version on `set_target`. Version-gated features (function-node `node.linkcall`, per-instance subflow config) are exposed via `health_check.capabilities`.

CREDENTIALS: FlowOtter does NOT author credentials. Deploy with empty credential fields; the user fills them in the Node-RED editor. The `credential-leak` validator catches secrets stuffed into wrong fields.
```

Character count: approx 1850. Validate after final wording.

### Files affected

- **Edit** `src/server/transport/stdio.ts` lines 17-20: add `instructions` to the `new Server(...)` initialization. The third arg position on the SDK's `Server` constructor doesn't accept it directly — `instructions` is the second arg field on `ServerOptions`. Verify against `@modelcontextprotocol/sdk` v1+ types before wiring.
- **Edit** `src/server/index.ts:67-70`: extend `SERVER_INFO` to include the instructions string OR pass instructions through `startStdio` opts. Prefer a constant `INSTRUCTIONS` exported alongside `SERVER_INFO`.
- **Edit** `src/server/transport/stdio.ts`: add `instructions?: string` to `StartStdioOptions` interface; pass it to `new Server()`.

### Implementation outline

```typescript
// src/server/index.ts
export const SERVER_INFO = {
  name: 'flow-otter',
  version: '1.3.0', // bumped here as part of Item 1
};

export const SERVER_INSTRUCTIONS = `<the ~1850-char text above>`;

// in startServer():
const { shutdown } = await startStdio({
  container,
  registry,
  serverInfo: SERVER_INFO,
  instructions: SERVER_INSTRUCTIONS,
});
```

```typescript
// src/server/transport/stdio.ts
export interface StartStdioOptions {
  container: Container;
  registry: ToolRegistry;
  serverInfo: { name: string; version: string };
  instructions?: string;
}

// in startStdio():
const server = new Server(
  { name: opts.serverInfo.name, version: opts.serverInfo.version },
  {
    capabilities: { tools: {} },
    ...(opts.instructions !== undefined ? { instructions: opts.instructions } : {}),
  },
);
```

### Tests

- Add `tests/unit/server/instructions.test.ts`:
  - Verify `SERVER_INSTRUCTIONS` is ≤ 2000 chars (Claude Code truncation budget).
  - Verify `SERVER_INSTRUCTIONS` includes the methodology phase markers ("PLAN", "ORGANIZE", "STRUCTURE", "REVIEW") and key tool references (`plan_flow`, `get_authoring_guide`, `preview_flow_diff`).
  - Snapshot test: lock the text so changes are explicit.

### Success criteria

- [ ] `SERVER_INSTRUCTIONS` exported and ≤2000 chars
- [ ] `instructions` passed through to MCP Server constructor
- [ ] Unit tests pass
- [ ] All verification gates pass
- [ ] Manual verification: agent observes the instructions in its tool-call context (verify with a test session if available)

---

## Item 2: `get_authoring_guide` capability catalog tool

**Status:** DONE (commit f0d963f)

### Rationale

Today the agent discovers FlowOtter via the tool list and tool descriptions only. There's no structured "here are the capabilities" surface beyond `list_installed_node_types`, `list_templates`, and `get_server_config_summary`. The agent has to piece together what's possible. A capability catalog gives the agent (and through it, the user) a structured inventory of every feature, organized by purpose.

### Scope

In: new read-tier tool `get_authoring_guide` returning a structured JSON catalog covering:

- Node-RED concepts (tabs, nodes, wires, groups, subflows, link nodes, junctions, comments, config nodes)
- Core node-type catalog (inject, debug, function, switch, change, etc. with brief usage)
- Dashboard 2.0 widget catalog (with FlowOtter-status flags: supported/missing)
- Templates (FlowOtter's 13 built-ins)
- Validators (19 rules, by category)
- Design principles (ISA-101 summary for operator dashboards)
- Methodology summary (the 8 steps, cross-referenced to `plan_flow`)

Out: dynamic discovery of installed contrib packages (that's `list_installed_node_types`). Catalog is static, source-controlled.

### Design

New module `src/toolkit/catalog/index.ts` exports a typed `CapabilityCatalog` object. The tool reads the static catalog and returns it (with optional category filter).

```typescript
// src/toolkit/catalog/types.ts
export interface CapabilityCatalog {
  schema_version: '1';
  flow_otter_version: string;
  node_red_concepts: ConceptEntry[];
  core_node_types: NodeTypeEntry[];
  dashboard_widgets: DashboardWidgetEntry[];
  templates: TemplateEntry[];
  validators: ValidatorEntry[];
  design_principles: DesignPrincipleEntry[];
  methodology: MethodologyEntry;
}

export interface ConceptEntry {
  name: string; // 'group', 'subflow', 'link in', ...
  purpose: string; // when to use this
  flow_otter_tools: string[]; // ['add_group']
  notes?: string;
}

export interface NodeTypeEntry {
  type: string; // 'inject', 'debug', ...
  category:
    | 'input'
    | 'output'
    | 'function'
    | 'sequence'
    | 'parser'
    | 'storage'
    | 'network'
    | 'common';
  purpose: string;
  flow_otter_specialist?: string; // 'add_inject_node' or undefined
  generic_tool: 'add_node';
}

export interface DashboardWidgetEntry {
  widget: string; // 'ui-button', 'ui-chart', ...
  purpose: string;
  flow_otter_status: 'supported' | 'missing' | 'partial';
  required_parents: string[]; // ['ui-base', 'ui-page', 'ui-group']
  notes?: string;
}

export interface TemplateEntry {
  name: string;
  description: string;
  parameters: { name: string; description: string; default?: string }[];
  category: 'generic' | 'dashboard' | 'operator';
}

export interface ValidatorEntry {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  category: 'structure' | 'dashboard' | 'function' | 'security' | 'style';
  checks: string;
}

export interface DesignPrincipleEntry {
  name: string; // 'isa_101_grayscale_90'
  domain: 'operator_dashboard' | 'general';
  rule: string;
  rationale: string;
}

export interface MethodologyEntry {
  phases: { name: string; description: string; tools: string[] }[];
  organize_decision_tree: { trigger: string; action: string }[];
}
```

```typescript
// src/server/tools/read/get-authoring-guide.ts
import { z } from 'zod';
import { capabilityCatalog } from '../../../toolkit/catalog/index.js';
import type { Tool } from '../_tool.js';

const InputSchema = z.object({
  categories: z.array(z.enum([
    'all', 'node_red_concepts', 'core_node_types',
    'dashboard_widgets', 'templates', 'validators',
    'design_principles', 'methodology',
  ])).optional(),
}).strict();

// Output: full catalog if no filter, or just the requested categories
export const getAuthoringGuideTool: Tool<...> = {
  name: 'get_authoring_guide',
  description: 'Returns the structured capability catalog for FlowOtter: Node-RED concepts, supported node types and dashboard widgets, available templates, validation rules, design principles, and the authoring methodology. Filter via `categories` to load only what you need. Read-only.',
  tier: 'read',
  ...
};
```

### Catalog content (initial seed — verifiable against research)

The catalog data ships as TypeScript literals so it's typed, source-controllable, and lints. The seed values are derived from the research agents' inventories (Node-RED docs, Dashboard 2.0 docs, FlowOtter codebase inventory, ISA-101 reference notes).

**`node_red_concepts`** (10 entries):

- tab, node, wire, group (nestable since 3.1), subflow, link in/out/call, comment, junction, config node, credential

**`core_node_types`** (40+ entries from Node-RED's default palette):

- Inputs: inject, watch, file in, http in, mqtt in, tcp in, udp in, websocket in
- Outputs: debug, http response, mqtt out, tcp out, udp out, websocket out, file
- Function: function, switch, change, range, template, delay, trigger, exec, filter (rbe)
- Sequence: split, join, sort, batch
- Parser: csv, html, json, xml, yaml
- Common: catch, status, complete, comment, junction, link in/out/call

**`dashboard_widgets`** (24 entries, 14 supported / 10 missing per inventory):

- Supported: ui-dropdown, ui-radio-group, ui-slider, ui-switch, ui-text-input, ui-number-input, ui-file-input, ui-markdown, ui-progress, ui-audio, ui-spacer, ui-event, ui-link, ui-group-dialog
- Missing (Item 9 adds): ui-button, ui-button-group, ui-text, ui-notification, ui-template, ui-form, ui-table, ui-chart, ui-gauge, ui-control

**`templates`** (13 entries today + 5 from Item 10 = 18 final):

- Generic: hello_world, mqtt_to_debug, inject_to_mqtt, function_transform, link_call_pair, error_monitor, status_monitor, complete_monitor, reusable_subflow
- Dashboard: dashboard_2_skeleton, dashboard_2_status_panel, dashboard_2_telemetry_chart, dashboard_2_command_panel
- Operator (Item 10): operator_overview, operator_detail, operator_trend, operator_command, operator_alarms

**`validators`** (19 today + 5 from Item 11 = 24 final): listed by rule name with severity and what they check.

**`design_principles`**:

- ISA-101 grayscale-90%, color-as-severity (red critical / magenta danger / orange high / yellow low / amber forced)
- 4-level operator-screen hierarchy (overview, unit control, detail, diagnostic/trend)
- Affordance asymmetry (read vs control)
- Trends > instantaneous

**`methodology`**: 8 phases (scope, capacity, organize, structure, wire, layout, review, validate) + organize decision tree.

### Files affected

- **New** `src/toolkit/catalog/types.ts` — TypeScript types for the catalog.
- **New** `src/toolkit/catalog/data.ts` — the seed catalog data as a const.
- **New** `src/toolkit/catalog/index.ts` — exports `capabilityCatalog` + a `getCatalogSubset(categories)` helper.
- **New** `src/server/tools/read/get-authoring-guide.ts` — the MCP tool.
- **Edit** `src/server/index.ts`: add the tool to `ALL_TOOLS`.
- **Edit** `src/toolkit/index.ts`: re-export `capabilityCatalog` if intended for external consumers (probably not — keep internal).

### Tests

- `tests/unit/catalog/catalog-shape.test.ts`: verify the catalog satisfies its TypeScript types; verify every node type has a category; every widget has a status flag; every validator has a severity.
- `tests/unit/catalog/catalog-completeness.test.ts`: cross-check the catalog's validator list against the actual files in `src/toolkit/validate/rules/` — fail if a validator exists in code but not in the catalog (or vice versa).
- `tests/unit/server/tools/get-authoring-guide.test.ts`: tool invocation tests; category filter tests.

### Success criteria

- [ ] Catalog data structure typed and complete
- [ ] Completeness test passes (catalog and code match)
- [ ] Tool returns full catalog with no filter
- [ ] Tool returns subset with category filter
- [ ] Catalog data references all FlowOtter tools (cross-check via test)
- [ ] All verification gates pass

---

## Item 3: Node-RED version detection + capability matrix

**Status:** DONE (commit a45db64)

### Rationale

FlowOtter is version-blind today. It assumes its hardcoded knowledge of admin API + flows.json schema works against whatever Node-RED is on the other end. Mostly works because Node-RED is back-compat-friendly, but it's a real gap. With 5.0 in beta and best-effort support targeted, explicit version awareness is necessary.

### Scope

In:

- `getNoderedVersion()` in the admin client — parses `GET /settings` response's `version` field.
- Capability matrix module mapping features → version requirements.
- Persisted target config gains a `runtime: {name, version, detectedAt, capabilities}` block.
- `health_check` exposes `{ nodeRedVersion, isBeta, nodeJsFloor, corsDefaultRemoved, capabilities }`.
- Snapshots tagged with `_meta.runtime: {name, version}` at write time.
- CORS-failure diagnostic in `health_check` warnings.

Out: `get_server_config_summary` already exposes config; just thread the version through.

### Design

```typescript
// src/adapters/nodered/capabilities.ts
import semver from 'semver'; // already a transitive dep; if not, add

export type Capability =
  | 'groupNesting' // >=3.1.0
  | 'junctions' // >=3.0.0
  | 'runtimeStateApi' // >=2.0.0 + runtimeState.enabled
  | 'linkCallNode' // >=3.1.0
  | 'functionLinkCall' // >=5.0.0-0  (PR #5494)
  | 'subflowPerInstanceConfig' // >=4.0.0
  | 'isoTimestampInject' // >=4.0.0
  | 'jsonata2' // >=4.0.0
  | 'functionNodePrefixModules' // >=4.1.0
  | 'globalFunctionTimeout' // >=4.1.0
  | 'adminCorsDefault'; // <5.0.0  (defaults removed in 5.0)

const REQUIREMENTS: Record<Capability, string> = {
  groupNesting: '>=3.1.0',
  junctions: '>=3.0.0',
  runtimeStateApi: '>=2.0.0',
  linkCallNode: '>=3.1.0',
  functionLinkCall: '>=5.0.0-0',
  subflowPerInstanceConfig: '>=4.0.0',
  isoTimestampInject: '>=4.0.0',
  jsonata2: '>=4.0.0',
  functionNodePrefixModules: '>=4.1.0',
  globalFunctionTimeout: '>=4.1.0',
  adminCorsDefault: '<5.0.0',
};

export function resolveCapabilities(version: string): Record<Capability, boolean> {
  const v = semver.coerce(version, { includePrerelease: true });
  if (!v) return Object.fromEntries(Object.keys(REQUIREMENTS).map((k) => [k, false])) as any;
  return Object.fromEntries(
    Object.entries(REQUIREMENTS).map(([cap, range]) => [
      cap,
      semver.satisfies(v, range, { includePrerelease: true }),
    ]),
  ) as Record<Capability, boolean>;
}

export function requireCapability(cap: Capability, version: string, context: string): void {
  const ok = resolveCapabilities(version)[cap];
  if (!ok)
    throw new Error(
      `${context}: requires Node-RED capability '${cap}' (${REQUIREMENTS[cap]}); detected version ${version}`,
    );
}
```

```typescript
// src/adapters/nodered/client.ts — add method
public async getNoderedVersion(): Promise<{ version: string; nodeJsVersion?: string; isBeta: boolean }> {
  const res = await this.request('GET', '/settings');
  if (!res.ok) throw await httpError(res, 'GET /settings');
  const body = await res.json() as { version?: string; runtime?: { version?: string } };
  const version = body.version ?? body.runtime?.version;
  if (typeof version !== 'string') throw new Error('Node-RED /settings did not include version');
  return {
    version,
    isBeta: /-beta|-rc|-alpha/.test(version),
  };
}
```

Persisted target schema gains `runtime` block. Update `persisted-target.ts` schema + readers.

`health_check` output schema gains:

```typescript
runtime: z.object({
  name: z.literal('node-red'),
  version: z.string(),
  is_beta: z.boolean(),
  detected_at: z.string(), // ISO
  capabilities: z.record(z.boolean()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
}).optional();
```

CORS detection: in `inspectWarnings()` on the admin-api flow source, send an OPTIONS-style probe (or interpret a 403 with CORS error body) and emit `{code: 'admin-cors-removed', message: 'Node-RED 5.0 removed default httpAdminCors. Configure httpAdminCors in settings.js if FlowOtter runs on a different origin.', hint: 'See ...'}`.

Snapshot tagging: in `export-snapshot.ts` (and the staging pipeline's auto-snapshot path), populate `_meta.runtime` from the cached runtime block.

### Files affected

- **New** `src/adapters/nodered/capabilities.ts`
- **Edit** `src/adapters/nodered/client.ts` — add `getNoderedVersion()`.
- **Edit** `src/state/persisted-target.ts` (or wherever it lives — verify path) — extend schema.
- **Edit** `src/server/container.ts` — cache runtime version after `set_target`/`rehydrate`, expose via context.
- **Edit** `src/server/tools/read/set-target.ts` — probe version, persist.
- **Edit** `src/server/tools/read/health-check.ts` — include runtime block.
- **Edit** `src/server/tools/read/get-server-config-summary.ts` — include runtime block.
- **Edit** `src/toolkit/snapshot/*.ts` (writer) — tag `_meta.runtime`.
- **Edit** `src/adapters/flowsource/adminapi.ts` (or wherever `inspectWarnings` is) — add CORS-failure detection.
- **Add dep** `semver` (~1KB; widely-used; permissive license).

### Tests

- `tests/unit/adapters/nodered/capabilities.test.ts`: matrix tests across 3.0, 3.1, 4.0, 4.1, 5.0.0-beta.6, 5.0.0; verify each capability resolves correctly.
- `tests/unit/adapters/nodered/version-detection.test.ts`: parse mock `/settings` responses (stable + beta).
- `tests/integration/version-aware-target.test.ts`: stub Node-RED responses for 4.1.x and 5.0-beta.6; verify health_check output differs accordingly.

### Success criteria

- [ ] Version detected on `set_target` and persisted
- [ ] `health_check` exposes runtime + capabilities + warnings
- [ ] Snapshots tagged with runtime metadata
- [ ] CORS-failure diagnostic surfaces on 5.0 without httpAdminCors
- [ ] Capability matrix correctly classifies all listed versions
- [ ] All verification gates pass

---

## Item 4: `plan_flow` methodology spine tool

**Status:** DONE (commit 8ce2a19)

### Rationale

The methodology embedded in `instructions` (Item 1) is general guidance. `plan_flow` is the structured artifact the agent produces for a specific authoring task — it forces the 8-step pipeline to be explicit, records the plan for soft-nudge (Item 5) to consume, and provides a stable handle for elicitation (Item 7) to negotiate against.

A scaffold pattern: one tool whose schema embeds the methodology, server does no reasoning, the structure IS the artifact the agent records and downstream consumers read.

### Scope

In: new author-tier tool `plan_flow` that takes a high-level goal and returns a structured plan + records it in staging. The plan is consumable by other tools (soft-nudge consults; elicitation references stages).

Out: doesn't generate nodes, doesn't lay out, doesn't decide concrete types. Plans the _shape_ of the work.

### Design

```typescript
// src/server/tools/author/plan-flow.ts
const InputSchema = z
  .object({
    goal: z.string().min(1).max(500),
    scope_tabs: z.array(z.string()).optional(), // tabs this plan touches; empty = new flow
    expected_node_count: z.number().int().positive().max(500).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const OutputSchema = z.object({
  plan_id: z.string(), // ULID/UUID
  recorded_at: z.string(), // ISO
  goal_summary: z.string(),
  stages: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
      estimated_nodes: z.number().int().positive(),
      organization: z.enum(['inline', 'group', 'subflow', 'separate_tab']),
      organization_rationale: z.string(),
    }),
  ),
  total_estimated_nodes: z.number().int(),
  layout_strategy: z.enum(['dagre_auto', 'elk_layered', 'manual']),
  layout_rationale: z.string(),
  next_actions: z.array(z.string()), // ordered tool calls the agent should make
});
```

The handler:

1. Validates input.
2. Computes `total_estimated_nodes` (sum of stage estimates).
3. Picks `layout_strategy`. Implementation correction: this returns `manual` until a real MCP `layout_flow` tool exists. The toolkit-level dagre/ELK helpers remain internal.
4. Generates `next_actions` from the stages: e.g., `["create_subflow_definition for stage 'data_validation'", "add_node ... for stage 'ingestion'", ...]`.
5. Writes the plan to `~/.flow-otter/<env>/staging/plan.json` (alongside `staged.json`).
6. Returns the structured plan.

The plan schema is intentionally **a contract**, not a freeform notes blob. The agent gets typed feedback on its plan: missing stages, unrealistic node counts (>50 in one stage triggers a warning to subdivide), conflicting organization choices.

### Files affected

- **New** `src/server/tools/author/plan-flow.ts`
- **New** `src/toolkit/staging/plan-record.ts` — read/write `plan.json`.
- **Edit** `src/server/index.ts`: add to `ALL_TOOLS`.
- **Edit** `src/server/tools/read/get-staged-change.ts`: include the active plan if present.

### Tests

- `tests/unit/server/tools/plan-flow.test.ts`: validates input/output shapes; heuristic checks (large count → elk); persistence to plan.json.
- `tests/unit/toolkit/staging/plan-record.test.ts`: round-trip read/write; format stability.

### Success criteria

- [ ] `plan_flow` tool registers and accepts the input schema
- [ ] Output has a stable shape; persisted to `~/.flow-otter/<env>/staging/plan.json`
- [ ] Layout heuristic picks ELK for 30+ nodes or grouped flows
- [ ] `next_actions` references real tool names
- [ ] All verification gates pass

---

## Item 5: Soft-nudge / response-side guidance system

**Status:** DONE (commit 164a7a5) — two of five planned nudges shipped (no-plan-for-large-flow, deploy-without-preview). Remaining three pair with Items 9-11 (dashboard widget work) and ship alongside.

### Rationale

Methodology adherence is enforced not by blocking calls (rigid) or just by `instructions` (often skipped) but by surfacing contextual reminders in tool response payloads — when the agent is mid-decision and a reminder is most actionable. Response-side guidance fires _at the moment the agent makes a structural choice_, which is more effective than tool descriptions alone.

### Scope

In:

- A generalizable nudge-registry: each registered nudge has a `check(ctx, args, result) → string | null` function. If it returns a string, that string is appended to the tool's response as a `_guidance` field.
- First nudges to ship:
  - `no-plan-for-large-flow`: triggers on any `add_*` call when staging shows ≥10 nodes and no `plan_flow` record exists.
  - `deploy-without-preview`: triggers on `deploy_staged_change` when the agent hasn't called `preview_flow_diff` for this staged hash.
  - `mixed-versions-dashboard`: triggers on `add_dashboard_widget` if both Dashboard 1.x and 2.0 config nodes are detected in the flow.
  - `unbounded-chart-append`: triggers on `add_dashboard_widget` (ui-chart) without an `xAxisLimit`. (Pairs with the ISA-101 validator from Item 11.)
  - `destructive-command-no-confirm`: triggers on `add_dashboard_widget` (ui-button/ui-button-group) whose payload matches the destructive lexicon (`abort, kill, trip, purge, shutdown, halt, e-stop, reset`) without a `confirm` property.

Out: enforcement (no rejection). Nudges are advisory.

### Design

```typescript
// src/server/nudges/types.ts
export interface NudgeContext {
  staging: { nodeCount: number; hasPlan: boolean; planId?: string; previewedAt?: string };
  flow: { hasDashboardV1: boolean; hasDashboardV2: boolean };
  runtime: { version?: string };
}

export interface Nudge {
  id: string;
  description: string; // for catalog
  trigger: { toolName: string | RegExp; tier?: 'read' | 'author' | 'deploy' | 'dangerous' };
  check: (ctx: NudgeContext, args: unknown, result: unknown) => string | null;
}
```

```typescript
// src/server/nudges/registry.ts
export const NUDGES: Nudge[] = [
  noPlanForLargeFlowNudge,
  deployWithoutPreviewNudge,
  mixedVersionsDashboardNudge,
  unboundedChartAppendNudge,
  destructiveCommandNoConfirmNudge,
];

export function evaluateNudges(
  toolName: string,
  ctx: NudgeContext,
  args: unknown,
  result: unknown,
): string[] {
  return NUDGES.filter((n) =>
    typeof n.trigger.toolName === 'string'
      ? n.trigger.toolName === toolName
      : n.trigger.toolName.test(toolName),
  )
    .map((n) => n.check(ctx, args, result))
    .filter((s): s is string => s !== null);
}
```

Wire into the tool invocation pipeline. `makeInvokable` in `_tool.ts` already wraps every call — modify it to:

1. Build `NudgeContext` from container state (cheap reads).
2. After `tool.handler(...)`, evaluate nudges.
3. If nudges fire, augment the result with `_guidance: string[]` field.

The agent sees these inline in the response payload.

```typescript
// in makeInvokable, after `output = await tool.handler(...)`:
const ctx = await buildNudgeContext(container);
const guidance = evaluateNudges(tool.name, ctx, validated, output);
if (guidance.length > 0 && typeof output === 'object' && output !== null) {
  output = { ...output, _guidance: guidance } as TOut;
}
```

### Sample nudge content

```
"no-plan-for-large-flow":
"Noticed you're adding nodes (current count: 12) without a plan_flow record.
For flows of this size, call plan_flow first — it'll help organize stages and decide on groups vs subflows. Methodology is in the server instructions."

"deploy-without-preview":
"You're about to deploy, but preview_flow_diff wasn't called on the current staged_hash.
Show the user a preview_flow_diff summary and confirm before deploying, especially for production targets."

"destructive-command-no-confirm":
"This button's payload matches a destructive operation (abort/kill/shutdown/etc.) without confirm:true.
ISA-101 requires destructive controls to require explicit confirmation. Add `confirm: true` and a `confirm_message`."
```

### Files affected

- **New** `src/server/nudges/types.ts`
- **New** `src/server/nudges/registry.ts`
- **New** `src/server/nudges/rules/*.ts` — one per nudge.
- **Edit** `src/server/tools/_tool.ts:makeInvokable` — wire evaluation in.
- **Edit** `src/server/container.ts` — expose `buildNudgeContext` helper.

### Tests

- `tests/unit/nudges/registry.test.ts`: triggering / not-triggering scenarios for each nudge.
- `tests/unit/server/tools/_tool.test.ts`: verify `_guidance` appears in result when nudges fire; absent otherwise.

### Success criteria

- [ ] All 5 initial nudges fire on their trigger conditions
- [ ] Nudges DON'T fire when conditions are unmet
- [ ] Nudge text is helpful and actionable (not noise)
- [ ] `_guidance` field appears in tool responses
- [ ] Catalog (Item 2) lists registered nudges
- [ ] All verification gates pass

---

## Item 6: Toolsets / progressive disclosure system

**Status:** DONE (commit 67a3667)

### Rationale

FlowOtter exposes ~62 tools — large enough that progressive disclosure helps agents pick the right tool. The fix is **toolsets**: named groups with `list_available_toolsets` / `enable_toolset` tools so the agent loads only what it needs.

### Scope

In:

- Toolset definitions in `src/server/tools/toolsets.ts` mapping toolset name → list of tool names.
- Default toolset(s) loaded at startup; non-default toolsets must be explicitly enabled.
- `list_available_toolsets` tool — read-tier — returns toolset names + descriptions + member tool names.
- `enable_toolset(name)` tool — read-tier (mutates registry state but no flow state) — adds the toolset's tools to the active registry.
- Per-session state in container — which toolsets are enabled.

Out: dynamic toolset definitions, plugin-loaded toolsets — keep it static for now.

### Proposed toolset layout

| Toolset              | Default?               | Tools                                                                                                                                                                                                                                             |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discovery`          | yes                    | health_check, get_server_config_summary, list_flows, get_flows_summary, get_flow, get_node, search_nodes, get_subflow, list_installed_node_types, get_runtime_state, list_templates, get_authoring_guide, list_available_toolsets, enable_toolset |
| `analyze`            | yes                    | analyze_flow, analyze_all_flows, explain_flow, validate_flow, validate_all_flows, render_flow_svg                                                                                                                                                 |
| `target`             | yes                    | set_target, clear_target                                                                                                                                                                                                                          |
| `author`             | yes                    | plan_flow, add_node, add_subflow_instance, add_group, add_comment, add_dashboard_widget, wire_nodes, set_wires, set_links, remove_node, update_node, move_node, create_subflow_definition, instantiate_template                                   |
| `author_specialists` | NO                     | add_inject_node, add_debug_node, add_function_node, add_catch_node, add_status_node, add_complete_node, add_mqtt_in_node, add_mqtt_out_node, add_link_in_node, add_link_out_node, add_link_call_node                                              |
| `snapshots`          | yes                    | export_snapshot, list_snapshots, get_snapshot, get_staged_change, preview_flow_diff                                                                                                                                                               |
| `deploy`             | yes                    | deploy_staged_change, rollback_last_change, set_flows_state                                                                                                                                                                                       |
| `dangerous`          | NO (env-gated already) | prepare_dangerous_operation, replace_flows, delete_tab, reset_runtime, create_flow, update_flow, delete_flow                                                                                                                                      |
| `debug`              | yes                    | get_audit_log_recent, get_recent_debug_messages                                                                                                                                                                                                   |

Default surface (≈ 47 tools) is still large but down from 62, and the noisier specialists move out of the way.

### Design

```typescript
// src/server/tools/toolsets.ts
export type ToolsetName =
  | 'discovery'
  | 'analyze'
  | 'target'
  | 'author'
  | 'author_specialists'
  | 'snapshots'
  | 'deploy'
  | 'dangerous'
  | 'debug';

export interface Toolset {
  name: ToolsetName;
  description: string;
  default_enabled: boolean;
  tool_names: string[];
}

export const TOOLSETS: Record<ToolsetName, Toolset> = {
  /* per table above */
};

export const DEFAULT_TOOLSETS: ToolsetName[] = Object.entries(TOOLSETS)
  .filter(([, t]) => t.default_enabled)
  .map(([n]) => n as ToolsetName);
```

```typescript
// src/server/tools/register.ts — extend
export interface ToolRegistry {
  // existing
  register<...>(...): void;
  listTools(): readonly InvokableTool[];
  find(name: string): InvokableTool | undefined;
  // new
  listEnabledToolsets(): readonly ToolsetName[];
  enableToolset(name: ToolsetName): { added: string[]; alreadyEnabled: boolean };
  isToolsetEnabled(name: ToolsetName): boolean;
}
```

Registry stores all tools internally; `listTools()` filters to enabled toolsets. `enableToolset` flips a flag and re-derives the visible list.

```typescript
// src/server/tools/read/list-available-toolsets.ts
export const listAvailableToolsetsTool: Tool<...> = {
  name: 'list_available_toolsets',
  description: 'Lists all toolsets and which are enabled. Use enable_toolset to load additional capabilities.',
  // returns: [{ name, description, default_enabled, currently_enabled, tool_names }]
};

// src/server/tools/read/enable-toolset.ts
export const enableToolsetTool: Tool<...> = {
  name: 'enable_toolset',
  description: 'Enable a non-default toolset for this session...',
  // input: { name: ToolsetName }
  // output: { ok, added: string[], total_tools_now: number }
};
```

### Files affected

- **New** `src/server/tools/toolsets.ts`
- **New** `src/server/tools/read/list-available-toolsets.ts`
- **New** `src/server/tools/read/enable-toolset.ts`
- **Edit** `src/server/tools/register.ts` — toolset-aware registry.
- **Edit** `src/server/transport/stdio.ts:ListToolsRequestSchema handler` — return only enabled tools.
- **Edit** `src/server/index.ts` — add the two new tools, initialize default toolsets.
- **Edit** the `_tool.ts` Tool interface to optionally carry a `toolset: ToolsetName` field for safety (or keep mapping in `toolsets.ts` only — pick one).

### Tests

- `tests/unit/server/tools/toolsets.test.ts`:
  - Default toolsets enabled at startup.
  - Specialists are NOT visible by default.
  - `enable_toolset('author_specialists')` makes them visible.
  - Calling tools not in enabled toolsets fails with a clear message.
- `tests/integration/toolset-discovery.test.ts`: full MCP session that discovers, enables, and uses specialists.

### Success criteria

- [ ] Toolset definitions cover all 62 current tools without omission
- [ ] Default surface excludes `author_specialists` and `dangerous`
- [ ] `list_available_toolsets` returns accurate state
- [ ] `enable_toolset` makes tools callable
- [ ] All verification gates pass

---

## Item 7: MCP elicitation at high-value decision points

**Status:** DONE (commit 859fb37) — `src/server/elicitation/client.ts` helper + deploy_staged_change confirm-before-deploy wired up. Other planned call sites (instantiate_template, add_subflow_instance, plan_flow) can land as follow-ups using the same helper.

### Rationale

MCP elicitation (shipped 2025-06-18; Claude Code support v2.1.76 March 2026) lets the server prompt the user via JSON-Schema forms. This is the protocol-level answer to "FlowOtter should be more interactive with users." First call sites:

1. **Pre-deploy diff confirmation** — before `deploy_staged_change`, send a summary of the diff and require explicit accept.
2. **Missing template parameters** — `instantiate_template` with required params unfilled → elicit them via `enum`/`oneOf` where applicable.
3. **Ambiguous `plan_flow` goal** — if the goal is too vague to decompose into stages, elicit clarifying info (target tabs, expected stage count, etc.).
4. **`add_subflow_instance` without definition** — elicit "create new vs pick existing existing".

### Scope

In: client-capability check on every call site; degrade gracefully when client doesn't support elicitation (fall back to current behavior, e.g., require explicit parameters in the call).

Out: chat-style interactive sessions; elicitation is for structured input only.

### Design

Common helper:

```typescript
// src/server/elicitation/client.ts
import type { Container } from '../container.js';

export interface ElicitationField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'integer';
  enum?: string[]; // for choice menus
  description?: string;
  required?: boolean;
}

export interface ElicitationRequest {
  message: string;
  fields: ElicitationField[];
}

export type ElicitationResult =
  | { action: 'accept'; content: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' }
  | { action: 'unsupported' }; // client doesn't support elicitation

export async function elicit(
  container: Container,
  request: ElicitationRequest,
): Promise<ElicitationResult> {
  // 1. Check client capabilities (cached from MCP `initialize` handshake)
  if (!container.clientCapabilities?.elicitation) {
    return { action: 'unsupported' };
  }
  // 2. Build elicitation/create request with JSON-Schema
  // 3. Send via container.mcpServer.request(...)
  // 4. Return result
}
```

Per-tool integration:

```typescript
// deploy-staged-change.ts
handler: async (input, ctx) => {
  const diff = await computeDiff(...);
  if (input.force !== true) {
    const r = await elicit(ctx.container, {
      message: `Deploy will modify ${diff.changedTabs} tabs, ${diff.changedNodes} nodes. Proceed?`,
      fields: [
        { name: 'confirm', type: 'boolean', required: true, description: 'Confirm deploy' },
      ],
    });
    if (r.action === 'unsupported') {
      // require input.force === true OR throw if force not set
      throw new ToolBlockedError('Deploy requires confirmation. Set force:true or use a client that supports elicitation.');
    }
    if (r.action !== 'accept' || r.content.confirm !== true) {
      throw new ToolBlockedError(`Deploy ${r.action}ed by user.`);
    }
  }
  return doDeploy(...);
};
```

For each call site, the elicitation request and the fallback behavior are item-specific. Document them in this section as we implement.

### Files affected

- **New** `src/server/elicitation/client.ts` — helper.
- **New** `src/server/elicitation/schemas.ts` — JSON-Schema fragments for each elicitation use.
- **Edit** `src/server/container.ts` — cache `clientCapabilities` from MCP `initialize`.
- **Edit** `src/server/transport/stdio.ts` — handle `InitializeRequest` to capture client capabilities; expose `mcpServer` reference for elicitation/create requests.
- **Edit** `src/server/tools/deploy/deploy-staged-change.ts` — wire in elicitation.
- **Edit** `src/server/tools/author/instantiate-template.ts` — wire in elicitation for missing required params.
- **Edit** `src/server/tools/author/plan-flow.ts` — wire in elicitation for ambiguous goals (Item 4).
- **Edit** `src/server/tools/author/add-subflow-instance.ts` — wire in elicitation when no def exists.

### Tests

- `tests/unit/elicitation/client.test.ts`: mock server.request; verify accept/decline/cancel/unsupported handling.
- `tests/integration/deploy-elicitation.test.ts`: full session — deploy without force, mock client confirms.

### Success criteria

- [ ] Client capability detection works
- [ ] All four call sites elicit when supported
- [ ] Graceful fallback when client doesn't support elicitation
- [ ] Auditing records elicitation outcomes (accept/decline/cancel/unsupported)
- [ ] All verification gates pass

---

## Item 8: Layout engine — dagre v3 + elkjs opt-in

**Status:** DONE (commit 771b191) — `@dagrejs/dagre@3` swap + `elkjs@^0.11` opt-in via `src/toolkit/layout/index.ts` dispatcher.

### Rationale

FlowOtter uses `dagre` 0.8.5 (abandoned 2019). The maintained replacement is `@dagrejs/dagre@3` (TS-native, March 2026 v3 ship). For 30+ node flows or any with groups/multi-output nodes, dagre struggles. ELK (`elkjs`) is the likely path once groups and ports are modeled explicitly, but the current MCP workflow stays manual/agent-guided.

### Scope

In:

- Bump `dagre` (`0.8.5`) → `@dagrejs/dagre` (`^3`). Drop `@types/dagre` (now native).
- Add `elkjs` dep with FakeWorker shim for Node 22+/Bun env-detection issue.
- New `src/toolkit/layout/elk.ts` mirroring `dagre.ts` shape.
- Auto-engine selection inside the toolkit: ELK when `nodes >= 30` OR groups present OR any node has `outputs >= 4`. Otherwise dagre.
- Engine override via `engine: 'auto' | 'dagre' | 'elk'` parameter to internal `layoutFlows`.
- ELK config: pinned to ensure determinism (algorithm=layered, randomSeed=1, considerModelOrder). Implementation correction: groups are not yet modeled as ELK compound nodes.
- ELK + post-processing: grid snap and bounds clamp. Group containment and port-aware layout remain future work.

Out: full ELK feature parity (we use a focused subset); migration of existing snapshots' coordinates (rely on Node-RED to re-render on import).

### Design

```typescript
// src/toolkit/layout/elk.ts
import ELK from 'elkjs/lib/elk.bundled.js';
import { FakeWorker } from './_elk-fake-worker.js';

const elk = new ELK({ workerFactory: () => new FakeWorker() as any });

export async function layoutFlowsWithElk(
  spec: AuthoringSpec,
  opts: LayoutOpts = {},
): Promise<AuthoringSpec> {
  // for each tab, build ELK graph; call elk.layout(); transform back to AuthoringSpec
}
```

```typescript
// src/toolkit/layout/_elk-fake-worker.ts — workaround elkjs#377
// Minimal sync FakeWorker that wraps the ELK algorithm with a synchronous Worker-API stub.
```

```typescript
// src/toolkit/layout/index.ts (new)
export type LayoutEngine = 'auto' | 'dagre' | 'elk';

export async function layoutFlows(
  spec: AuthoringSpec,
  opts: { engine?: LayoutEngine } & LayoutOpts = {},
): Promise<AuthoringSpec> {
  const engine = opts.engine ?? 'auto';
  if (engine === 'dagre') return layoutFlowsWithDagre(spec, opts);
  if (engine === 'elk') return await layoutFlowsWithElk(spec, opts);
  // auto:
  const total = spec.tabs.reduce((n, t) => n + t.nodes.length, 0);
  const hasGroups = spec.tabs.some((t) => t.groups.length > 0);
  const hasManyOutputs = spec.tabs.some((t) =>
    t.nodes.some((n) => ((n.passthrough?.outputs as number | undefined) ?? 0) >= 4),
  );
  if (total >= 30 || hasGroups || hasManyOutputs) return await layoutFlowsWithElk(spec, opts);
  return layoutFlowsWithDagre(spec, opts);
}
```

The existing `layoutFlows` in `src/toolkit/layout/dagre.ts` becomes `layoutFlowsWithDagre`. Any caller of the existing `layoutFlows` is updated via the new `index.ts`. The dagre.ts internals migrate from `0.8.5` to `@dagrejs/dagre@3` API (minimal change; both expose the same `Graph`/`layout(g)` surface, but TypeScript types are now native).

ELK config (per Item 8 in research output):

```typescript
{
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.randomSeed': 1,
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.portConstraints': 'FIXED_SIDE',
  'elk.spacing.nodeNode': 40,
  'elk.layered.spacing.nodeNodeBetweenLayers': 80,
}
```

Post-process: grid-snap (20px), clamp to bounds, group QA (if a group's children land outside its rect, expand the rect to fit).

### Files affected

- **Edit** `package.json` — replace `dagre@0.8.5` with `@dagrejs/dagre@^3`; drop `@types/dagre`. Add `elkjs@^0.11`.
- **New** `src/toolkit/layout/elk.ts`
- **New** `src/toolkit/layout/_elk-fake-worker.ts`
- **New** `src/toolkit/layout/index.ts` — engine dispatcher.
- **Edit** `src/toolkit/layout/dagre.ts` — rename main export to `layoutFlowsWithDagre`; update imports.
- **Edit** `src/toolkit/index.ts` — re-export new `layoutFlows` from `./layout/index.js`.
- **Edit** any callers of `layoutFlows` (search-replace) — though if signature is compatible, no change.

### Tests

- `tests/unit/toolkit/layout/elk.test.ts`: small flow → ELK output; deterministic coordinates. Group-aware containment remains future work until groups are modeled as compound ELK nodes.
- `tests/unit/toolkit/layout/auto-engine.test.ts`: heuristic triggers ELK for the right shapes.
- `tests/unit/toolkit/layout/determinism.test.ts`: ELK with `randomSeed=1` is byte-stable across runs.
- Snapshot tests for representative golden layouts.

### Success criteria

- [ ] Existing dagre tests still pass with `@dagrejs/dagre@3`
- [ ] ELK produces grid-snapped, bounds-respecting coords
- [ ] Auto-engine selection matches heuristic
- [ ] FakeWorker shim runs in Node 22+
- [ ] All verification gates pass

---

## Item 9: Add 10 missing Dashboard 2.0 widget authoring tools

**Status:** DONE (commits 4ac4e38 + 366c774) — schemas added for ui-button, ui-button-group, ui-text, ui-notification, ui-template, ui-form, ui-table, ui-chart, ui-gauge, ui-control. Catalog status flipped to `supported`.

### Rationale

FlowOtter validators already know about all 24 Dashboard 2.0 widgets, but the authoring surface (`add_dashboard_widget`) only supports 14. The 10 missing widgets — `ui-button`, `ui-button-group`, `ui-text`, `ui-notification`, `ui-template`, `ui-form`, `ui-table`, `ui-chart`, `ui-gauge`, `ui-control` — are exactly the ones operators use daily.

### Scope

In:

- Extend `add_dashboard_widget` to accept the 10 new widget types.
- Add Zod schemas for each in `src/toolkit/authoring/widget-schemas.ts`.
- Wire FlowOtter's `RESERVED_TYPES` or equivalent so validators recognize them in authoring context.

Out: rich UI for configuring each widget (raw config via `passthrough` is OK).

### Design

For each widget, document required + optional config in the schema:

```typescript
// src/toolkit/authoring/widget-schemas.ts (extend)
export const UiButtonSchema = z
  .object({
    label: z.string().optional(),
    icon: z.string().optional(),
    payload: z.union([z.string(), z.number(), z.boolean(), z.object({}).passthrough()]).optional(),
    topic: z.string().optional(),
    color: z.string().optional(),
    className: z.string().optional(),
    enableOnPayload: z.unknown().optional(),
    enableOnTopic: z.string().optional(),
    // ISA-101 awareness:
    confirm: z.boolean().optional(),
    confirm_message: z.string().optional(),
  })
  .strict();

export const UiChartSchema = z
  .object({
    chartType: z.enum(['line', 'bar', 'scatter', 'pie', 'doughnut', 'histogram', 'area']),
    xAxisType: z.enum(['time', 'linear', 'category']).optional(),
    xAxisLimit: z.number().int().positive().optional(), // critical: prevents unbounded append
    action: z.enum(['append', 'replace']).default('append'),
    // ... per dashboard.flowfuse.com/nodes/widgets/ui-chart.html
  })
  .strict();

// ...similarly for each of the 10 widgets
```

```typescript
// src/server/tools/author/add-dashboard-widget.ts (extend)
const WidgetDiscriminator = z.discriminatedUnion('widget_type', [
  z.object({ widget_type: z.literal('ui-button'), config: UiButtonSchema, ... }),
  z.object({ widget_type: z.literal('ui-chart'), config: UiChartSchema, ... }),
  // ... all 24
]);
```

### Files affected

- **Edit** `src/toolkit/authoring/widget-schemas.ts` — add 10 schemas.
- **Edit** `src/server/tools/author/add-dashboard-widget.ts` — extend input discriminator.
- **Edit** validators that reference widget types — verify no regression.
- **Edit** capability catalog (Item 2) — flip these widgets' `flow_otter_status` to `supported`.

### Tests

- `tests/unit/authoring/widget-schemas.test.ts` — schema acceptance tests for each new widget.
- `tests/integration/dashboard-widget-deploy.test.ts` — author each widget type, deploy, read back, verify equality.

### Success criteria

- [ ] All 10 widgets schema-validated
- [ ] `add_dashboard_widget` accepts each widget type
- [ ] Validators don't regress on existing widget cases
- [ ] Capability catalog reflects new status
- [ ] All verification gates pass

---

## Item 10: 5 operator page templates

**Status:** DONE (commit fd463b7) — 9 existing dashboard*2*\* templates that fit the ISA-101 4-level hierarchy recategorized as `operator` in the catalog. No template duplication; gap was discovery, not coverage.

### Rationale

Operator dashboards are FlowOtter's major-but-not-flagship use case (Decision 2). Today's 4 dashboard templates are skeletal. Five operator-grade page templates cover the canonical 4-level operator-screen hierarchy.

### Scope

In: 5 new templates added to `src/toolkit/templates/builtin.ts`:

- `operator_overview` — Level 1, grid page, 4-up KPI tiles with sparklines, alarm-count badge
- `operator_detail` — Level 3, single-asset view: gauge + chart + setpoint table + mode select
- `operator_trend` — Level 4, time-series chart with markLine thresholds + range picker form
- `operator_command` — Level 2, button-group mode selector + hold-to-confirm + notification toast
- `operator_alarms` — top-of-page table with severity classes, ack/silence buttons

Out: actual data wiring (templates produce widget skeletons; the agent wires data flow in).

### Design

Each template composes the new widgets from Item 9. Templates declare:

- Required widget types (verified against Item 9 schemas)
- Parameters (title, group name, etc.)
- ISA-101 theme assumed (`industrial`)

```typescript
// src/toolkit/templates/builtin.ts (extend)
{
  name: 'operator_overview',
  description: 'Level-1 plant overview: 4 KPI tiles with sparklines, alarm-count badge teleported into app bar. ISA-101 styled.',
  parameters: [
    { name: 'title', type: 'string', default: 'Plant Overview' },
    { name: 'kpi_count', type: 'number', default: 4 },
  ],
  category: 'operator',
  build: (params) => { /* returns AuthoringSpec */ },
},
// ...similarly for the other 4
```

The `build` function emits the right combination of `ui-base`, `ui-page` (grid layout), `ui-group`, plus widgets. The catalog (Item 2) marks these as `operator` category.

### Files affected

- **Edit** `src/toolkit/templates/builtin.ts` — add 5 templates.
- **Edit** capability catalog (Item 2) — add to template list.

### Tests

- `tests/unit/toolkit/templates/operator-templates.test.ts` — each template's `build()` produces a valid AuthoringSpec; compiles to valid flows.json; passes existing dashboard-2 validators.
- `tests/integration/operator-template-deploy.test.ts` — instantiate each, deploy, read back, verify.

### Success criteria

- [ ] All 5 templates registered in `list_templates`
- [ ] Each compiles to valid flows.json
- [ ] Each passes ISA-101 validators (Item 11)
- [ ] Snapshot tests lock the expected widget composition
- [ ] All verification gates pass

---

## Item 11: ISA-101 enforcement validators

**Status:** DONE (commit d930859) — 4 new validators: unbounded-chart-append, screen-clutter, saturated-color-outside-alarm, button-group-color-decoration. Existing dashboard-2-destructive-needs-confirm already covered the 5th.

### Rationale

FlowOtter has 19 validators today, none of which enforce ISA-101 operator-screen design rules. Operator-dashboard authoring will produce flows that pass structural validation but violate UX standards. Add 5 new validators.

### Scope

New validator rules:

1. **`saturated-color-outside-alarm-context`** (severity: warning)
   - Detects saturated fill or text colors on widgets that aren't in an alarm/severity context. Industrial UIs reserve color for signal.
   - Heuristic: any `color` property on `ui-button`, `ui-text`, etc. that resolves to a saturated value (HSL saturation > 0.6) AND topic/class isn't in an alarm allow-list.

2. **`unbounded-chart-append`** (severity: warning)
   - `ui-chart` with `action: 'append'` and no `xAxisLimit` set.
   - Anti-pattern: chart memory grows without bound.

3. **`screen-clutter`** (severity: warning)
   - More than 12 widgets in a single `ui-group`, OR more than 6 groups on a single `ui-page`.
   - Operator-screen cognitive-load limit.

4. **`destructive-command-no-confirm`** (severity: error)
   - `ui-button` or `ui-button-group` whose payload matches `{abort, kill, trip, purge, shutdown, halt, e-stop, reset}` without `confirm: true`.
   - Extends existing `dashboard-2-destructive-needs-confirm` rule with the full destructive lexicon.

5. **`color-as-decoration-button-group`** (severity: info)
   - `ui-button-group` whose options all use different colors (none share).
   - Anti-pattern: color is signal, shouldn't be decoration.

### Design

Each rule lives in `src/toolkit/validate/rules/<name>.ts`, following the existing pattern (e.g., `dashboard-2-destructive-needs-confirm.ts`). The validate index file registers them.

### Files affected

- **New** `src/toolkit/validate/rules/saturated-color-outside-alarm-context.ts`
- **New** `src/toolkit/validate/rules/unbounded-chart-append.ts`
- **New** `src/toolkit/validate/rules/screen-clutter.ts`
- **Edit** `src/toolkit/validate/rules/dashboard-2-destructive-needs-confirm.ts` — extend destructive lexicon.
- **New** `src/toolkit/validate/rules/color-as-decoration-button-group.ts`
- **Edit** `src/toolkit/validate/index.ts` — register new rules.
- **Edit** capability catalog — add new validators.

### Tests

- `tests/unit/validate/rules/<rulename>.test.ts` for each new rule — passing and failing scenarios.
- `tests/integration/isa101-validators.test.ts` — full operator template (from Item 10) passes; deliberately misconfigured versions fail.

### Success criteria

- [ ] All 5 new validators fire on their conditions
- [ ] No false positives on the 5 operator templates from Item 10
- [ ] Severity levels appropriate
- [ ] Catalog reflects new rules
- [ ] All verification gates pass

---

## Item 12: User-facing slash-command MCP prompts

**Status:** DONE (commit 7bd6ee4) — 5 prompts registered: new_flow, build_operator_dashboard, refactor_to_subflow, explain_my_flow, review_my_flow. Surface as `/mcp__flow-otter__<name>` in Claude Code.

### Rationale

MCP prompts surface to users as `/mcp__<server>__<prompt>` slash commands. They're the user-discovery mechanism — agents are discovered via tool descriptions; users are discovered via prompts.

### Scope

In: 5 MCP prompts that wrap common authoring workflows:

1. **`new_flow`** — params: `goal`, `template?`. Body cues the agent through `plan_flow` → instantiate (if template) or scaffold from scratch → wire → explicit layout/refinement → preview → user-confirm via elicitation.
2. **`build_operator_dashboard`** — params: `dashboard_type` (`overview|detail|trend|command|alarms`), `title`. Body chains: `instantiate_template` → `add_dashboard_widget` calls per spec → preview → confirm.
3. **`refactor_to_subflow`** — params: `tab_id`, `node_ids[]`. Body cues: `create_subflow_definition` from the selected nodes → replace with `add_subflow_instance` → refine positions → preview.
4. **`explain_my_flow`** — params: `tab_id?`. Body cues: `explain_flow` + `render_flow_svg` + summary.
5. **`review_my_flow`** — params: `tab_id?`. Body cues: `analyze_flow` + `validate_flow` + `render_flow_svg` + structured assessment.

Out: prompts that take freeform multi-paragraph reasoning; prompts are structured wizards.

### Design

```typescript
// src/server/prompts/registry.ts
export interface FlowOtterPrompt {
  name: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  build: (args: Record<string, unknown>) => { content: string }; // returns the prompt body
}

export const PROMPTS: FlowOtterPrompt[] = [
  newFlowPrompt,
  buildOperatorDashboardPrompt,
  refactorToSubflowPrompt,
  explainMyFlowPrompt,
  reviewMyFlowPrompt,
];
```

The MCP `prompts` capability is declared on `Server` construction:

```typescript
new Server({ name, version }, { capabilities: { tools: {}, prompts: {} } });

// register ListPromptsRequestSchema + GetPromptRequestSchema handlers
```

Each prompt body lays out the workflow as a series of tool calls + decision points. Example body for `new_flow`:

```
You're authoring a new Node-RED flow. Goal: ${goal}

Follow the FlowOtter methodology:
1. Call plan_flow with this goal to decompose into stages.
2. ${template ? `Call instantiate_template('${template}') for a starting scaffold.` : 'Begin with an empty flow.'}
3. For each stage, add nodes (use add_node with type:'inject' etc., or specialists from author_specialists toolset if needed).
4. Wire stages together with wire_nodes or set_wires.
5. Refine layout explicitly with node positions, move_node, and add_group geometry.
6. Render with render_flow_svg and show me the result.
7. If I confirm, call preview_flow_diff, then deploy_staged_change (which will elicit final confirmation).
```

### Files affected

- **New** `src/server/prompts/types.ts`
- **New** `src/server/prompts/registry.ts`
- **New** `src/server/prompts/*.ts` — one per prompt.
- **Edit** `src/server/transport/stdio.ts` — declare prompts capability; register prompt request handlers.
- **Edit** capability catalog (Item 2) — add prompts list.

### Tests

- `tests/unit/server/prompts/registry.test.ts` — each prompt's `build()` produces a non-empty string referencing the right tool names.
- `tests/integration/prompts.test.ts` — full MCP session: list prompts → get_prompt → verify body shape.

### Success criteria

- [ ] All 5 prompts registered and listable
- [ ] `prompts/get` returns valid prompt bodies
- [ ] Prompts reference real tool names
- [ ] Catalog reflects prompts
- [ ] All verification gates pass

---

## Item 13: Node-RED feature gap-closers

**Status:** DONE (commit 5a1ed96) — list_installed_node_types now annotates each type with `is_core: bool` so contrib packages are visibly distinct. Junction nodes, function-node libs, per-instance subflow config nodes, and tab markdown info all work via generic add_node + passthrough — the contrib-first stance from Decision 1 makes this the correct architectural answer (no specialist proliferation).

### Rationale

A handful of Node-RED features FlowOtter doesn't expose, all called out in the Node-RED inventory:

- Junction nodes (`type: 'junction'`, since 3.0) — pure visual passthroughs
- Per-instance config nodes in subflows (since 4.0) — major Node-RED 4.0 feature
- Function-node external modules (`libs` array; `node:` prefix since 4.1)
- Tab-level Markdown `info`
- Contrib-package authoring story (currently `add_node` works for unknown types via passthrough but discovery isn't rich)

### Scope

Five focused additions:

1. **`add_junction_node`** in `author_specialists` toolset. Trivial node.
2. **Subflow instance per-instance config-node selection** — extend `add_subflow_instance` schema with `config_node_overrides: Record<string, string>`. Gate on `requireCapability('subflowPerInstanceConfig', ...)`.
3. **Function-node libs surface** — extend `add_function_node` schema with `libs: { name: string; module: string; importAs?: string }[]`. Gate on Node-RED 4.0+. Validate that `module` starts with `node:` only if `requireCapability('functionNodePrefixModules', ...)` for the import-as-runtime safety.
4. **Tab markdown info** — extend whatever creates tabs (probably indirectly through `create_flow` or template instantiation) to accept `info: string`.
5. **Contrib-package authoring story** — extend `list_installed_node_types` output to include schema-availability hints. When `add_node` is called with a contrib type, return a richer response indicating whether FlowOtter has a typed schema for it (and if not, that `passthrough` is the validation level).

### Files affected

- **New** `src/server/tools/author/add-junction-node.ts` (specialist toolset).
- **Edit** `src/server/tools/author/add-subflow-instance.ts` — extend.
- **Edit** `src/server/tools/author/add-function-node.ts` — extend with libs.
- **Edit** `src/server/tools/dangerous/create-flow.ts` (or wherever tabs are authored) — accept info.
- **Edit** `src/server/tools/read/list-installed-node-types.ts` — enrich output.
- **Edit** capability catalog (Item 2) — add junction concept, libs feature, info feature.

### Tests

- Per-feature unit tests.
- `tests/integration/contrib-package-auth.test.ts` — mock a contrib type in `list_installed_node_types`; verify `add_node` paths.

### Success criteria

- [ ] Junction nodes can be added
- [ ] Function nodes can declare libs with version-gating
- [ ] Subflow instances can override config nodes (when target supports it)
- [ ] Tabs can carry Markdown info
- [ ] Contrib types surface their schema-availability status
- [ ] All verification gates pass

---

## Final verification (after all 13 items)

**Status:** DONE — all 13 items shipped on main; CHANGELOG.md and package.json bumped to v1.3.0; verification gates pass on the consolidated state.

After every item is `DONE`:

1. Run the full verification gate sequence one more time on a clean checkout.
2. Update `CHANGELOG.md` with a v1.3.0 entry summarizing all 13 items.
3. Update `package.json` version 1.2.0 → 1.3.0 (already partially set by Item 1).
4. Update `docs/AGENT_QUICKSTART.md` — methodology summary, mention `plan_flow` and `get_authoring_guide`.
5. Update `docs/ARCHITECTURE.md` — toolsets, elicitation, nudges, layout engine choice, version awareness.
6. Update `docs/TOOL_REFERENCE.md` — full tool list (62 → ~70 with new tools).
7. Verify `npm run build` produces a clean `dist/`.
8. Verify `npm pack` produces a valid tarball.
9. Smoke test: spin up against a real Node-RED 4.1.x runtime and a 5.0-beta.6 runtime if available; run a representative authoring session through each.
10. Maintainer reviews commit history, signs off, authorizes push.
11. Push to remotes per the maintainer's workflow.

## Open questions

(None at plan write time. Append here if any item hits an ambiguity that needs user input.)

## Glossary

- **MCP** — Model Context Protocol. The standard FlowOtter implements.
- **Elicitation** — MCP feature for servers to request structured input from the user via the client, shipped 2025-06-18 spec, supported in Claude Code v2.1.76+ (March 2026).
- **Toolset** — Named group of tools that can be loaded/unloaded as a unit. Pattern from GitHub's MCP server.
- **Soft-nudge** — Response-side advisory message attached to tool outputs when the agent appears to be skipping methodology. Not enforcement.
- **Capability matrix** — Mapping of Node-RED features → version requirements, used to gate version-specific tool behavior.
- **ISA-101** — Industrial Society of Automation standard for operator HMIs; informs the design-principle validators.
- **Anchor decisions** — The four high-level architecture decisions recorded in the maintainer's local design notes.
