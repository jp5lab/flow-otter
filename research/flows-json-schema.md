# Node-RED `flows.json` Schema Reference

Documentation of every node-ish entity stored in a Node-RED `flows.json`, taken from runtime source (`@node-red/runtime/lib/flows/{util,Flow,Subflow,Group}.js`) and the official `node-red/flow-parser` library. Versions cited target Node-RED 2.x → 4.1. Where docs are silent, the runtime's `parseConfig` and `flow-parser`'s `NR*` classes are the ground truth. FlowOtter's `src/shared/flows-json.ts` zod model is checked against this in §4.

## 1. Top-level format

`flows.json` is **a flat JSON array**. No envelope, no `version` field, no `schema` field. The runtime's `parseConfig(config)` iterates the array directly (`packages/node_modules/@node-red/runtime/lib/flows/util.js`).

```json
[
  { "id": "...", "type": "tab", ... },
  { "id": "...", "type": "subflow", ... },
  { "id": "...", "type": "group", "z": "<tab-id>", ... },
  { "id": "...", "type": "comment", "z": "<tab-id>", ... },
  { "id": "...", "type": "junction", "z": "<tab-id>", ... },
  { "id": "...", "type": "inject", "z": "<tab-id>", "wires": [[]], ... },
  { "id": "...", "type": "mqtt-broker", ... },
  { "id": "...", "type": "subflow:abc123", "z": "<tab-id>", ... }
]
```

The runtime distinguishes entries by inspecting `type` and the presence of `x`/`y`/`z`/`wires`:

- `type === "tab"` → flow tab
- `type === "subflow"` → subflow definition
- `type === "group"` → group container
- `type === "comment"` → comment annotation
- `type === "junction"` → routing junction (3.0+)
- `type` starts with `subflow:` → subflow instance
- has `x` and `y` and `z` (and not above) → regular workspace node
- otherwise → config node (no canvas position)

Order is not load-significant; `parseConfig` walks the array twice and builds parent/child via `z` references. The editor preserves order on round-trip cosmetically. UTF-8 JSON, two-space indent by storage default.

## 2. Per-node-kind sections

### 2.1 Tab nodes (`type: "tab"`)

A flow tab. Always at the top level — `z` is _not_ present on a tab.

```json
{
  "id": "f1a2b3c4d5e6f708",
  "type": "tab",
  "label": "Flow 1",
  "disabled": false,
  "info": "",
  "env": []
}
```

| Field      | Type    | Required | Since | Notes                                                                                     |
| ---------- | ------- | -------- | ----- | ----------------------------------------------------------------------------------------- | --- | ---- | ---- | --- | ---- | ------- | ----------- |
| `id`       | string  | yes      | 0.x   | 16-char hex by editor convention; runtime treats as opaque.                               |
| `type`     | `"tab"` | yes      | 0.x   | Discriminator.                                                                            |
| `label`    | string  | yes      | 0.x   | User-visible tab label.                                                                   |
| `disabled` | boolean | no       | 0.20  | When `true`, skip start of nodes inside the tab. Diff via `oldConfig.flows[id].disabled`. |
| `info`     | string  | no       | 1.x   | Markdown description shown in the info sidebar.                                           |
| `env`      | array   | no       | 3.1   | Per-flow environment variables. Each entry: `{name,value,type}` where `type` is `str      | num | bool | json | env | cred | jsonata | conf-type`. |
| `locked`   | boolean | no       | 3.1   | When `true`, editor treats tab as read-only.                                              |

### 2.2 Subflow definition (`type: "subflow"`)

A reusable flow template. Like a tab, it has no `z`. Internal nodes carry `z = subflowDef.id`.

```json
{
  "id": "sf01abc234de56789",
  "type": "subflow",
  "name": "Pulse Wrapper",
  "info": "",
  "category": "function",
  "color": "#DDAA99",
  "icon": "node-red/timer.svg",
  "in": [{ "x": 60, "y": 40, "wires": [{ "id": "n_inner_inject" }] }],
  "out": [{ "x": 480, "y": 40, "wires": [{ "id": "n_inner_debug", "port": 0 }] }],
  "env": [
    {
      "name": "INTERVAL_MS",
      "type": "num",
      "value": "1000",
      "ui": {
        "label": { "en-US": "Interval (ms)" },
        "type": "input",
        "opts": { "types": ["num", "env"] }
      }
    }
  ],
  "meta": { "module": "node-red-contrib-pulse", "version": "1.0.0" },
  "status": { "x": 380, "y": 200, "wires": [{ "id": "n_inner_status", "port": 0 }] },
  "inputLabels": ["msg.payload"],
  "outputLabels": ["pulse"]
}
```

| Field          | Type        | Required | Since | Notes                                                                                                                                                      |
| -------------- | ----------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | string      | yes      | 0.x   | Referenced by subflow instance type as `subflow:<id>`.                                                                                                     |
| `type`         | `"subflow"` | yes      | 0.x   |                                                                                                                                                            |
| `name`         | string      | yes      | 0.x   | Display name used as the default instance label.                                                                                                           |
| `info`         | string      | no       | 0.x   | Markdown description.                                                                                                                                      |
| `category`     | string      | no       | 0.18  | Palette category.                                                                                                                                          |
| `color`        | string      | no       | 1.3   | Hex color for instance nodes.                                                                                                                              |
| `icon`         | string      | no       | 1.x   | SVG icon path, e.g. `node-red/cog.svg`.                                                                                                                    |
| `in`           | array       | no       | 0.x   | Input ports. Each: `{ x, y, wires: [{ id }] }`. Empty array or absent ⇒ no input (event-source subflow).                                                   |
| `out`          | array       | no       | 0.x   | Output ports. Each: `{ x, y, wires: [{ id, port }] }`.                                                                                                     |
| `env`          | array       | no       | 0.20  | Subflow-instance env spec. v3.0 added `ui` block; `cred` type for credential fields; `conf-type` for selecting a config node.                              |
| `meta`         | object      | no       | 1.3   | Used when subflow is packaged as a module — `{ module, version, author, type }`.                                                                           |
| `status`       | object      | no       | 1.1   | If present, defines a status output port: `{ x, y, wires: [{ id, port }] }`. The runtime spawns a `subflow-status` virtual node at `<instance-id>:status`. |
| `inputLabels`  | string[]    | no       | 0.20  | Hover labels for inputs.                                                                                                                                   |
| `outputLabels` | string[]    | no       | 0.20  | Hover labels for outputs.                                                                                                                                  |
| `flow`         | array       | no       | 1.3   | Used only for subflow-as-module packaging (sibling of `node-red-contrib-*` exports). Not present in user-authored `flows.json`.                            |

### 2.3 Subflow instance (`type: "subflow:<defId>"`)

A node whose type is `subflow:` plus the subflow definition's id. It behaves like a regular workspace node from a layout standpoint (has `x`/`y`/`z`/`wires`). Its only special field is `env` for instance-level overrides.

```json
{
  "id": "n_pulse_a",
  "type": "subflow:sf01abc234de56789",
  "z": "f1a2b3c4d5e6f708",
  "name": "Hourly pulse",
  "x": 240,
  "y": 160,
  "wires": [["n_downstream_debug"]],
  "env": [{ "name": "INTERVAL_MS", "value": "3600000", "type": "num" }]
}
```

| Field     | Type             | Required | Since | Notes                                                                   |
| --------- | ---------------- | -------- | ----- | ----------------------------------------------------------------------- |
| `type`    | `"subflow:<id>"` | yes      | 0.x   | Discriminator. The flow-parser regex `/^subflow:/` extracts the def id. |
| `env`     | array            | no       | 0.20  | Overrides of definition env. Same shape as in the definition.           |
| `g`       | string           | no       | 2.1   | Group membership.                                                       |
| `name`    | string           | no       | 0.x   | Per-instance label; falls back to the subflow definition's `name`.      |
| All other | —                | —        | —     | Inherits all standard regular-node fields (see §2.4).                   |

### 2.4 Regular workspace node

Every functional node in a flow — `inject`, `debug`, `function`, `change`, `switch`, `mqtt in`, `mqtt out`, `http in`, `http response`, `link in`, `link out`, `link call`, `catch`, `complete`, `status`, contrib-module nodes, etc. The runtime treats them uniformly and dispatches to the registered node constructor by `type`.

```json
{
  "id": "n_debug_1",
  "type": "debug",
  "z": "f1a2b3c4d5e6f708",
  "name": "out",
  "active": true,
  "tosidebar": true,
  "console": false,
  "tostatus": false,
  "complete": "true",
  "targetType": "full",
  "x": 480,
  "y": 160,
  "wires": [],
  "g": "g_main",
  "l": false,
  "d": false,
  "info": "Logs payload to sidebar.",
  "icon": "font-awesome/fa-bug",
  "inputLabels": ["payload"],
  "outputLabels": [],
  "_alias": "n_inner_debug",
  "_users": ["n_inject_1"]
}
```

#### Common fields (every regular node)

| Field          | Type         | Required | Since | Notes                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------ | -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | string       | yes      | 0.x   | 16-char hex; opaque; the only required identifier.                                                                                                                                                                                                                                                              |
| `type`         | string       | yes      | 0.x   | The registered node type. Anything not in the type registry shows up as `flow.missingTypes`.                                                                                                                                                                                                                    |
| `z`            | string       | yes      | 0.x   | Container id — a tab id or a subflow definition id. **A node with no `z` is treated as a config node.**                                                                                                                                                                                                         |
| `x`            | number       | yes¹     | 0.x   | Canvas X. ¹Required to count as a regular node; `parseConfig` keys off `hasOwnProperty('x') && hasOwnProperty('y')`.                                                                                                                                                                                            |
| `y`            | number       | yes¹     | 0.x   | Canvas Y.                                                                                                                                                                                                                                                                                                       |
| `wires`        | `string[][]` | yes      | 0.x   | Outer index = output port; inner array = target node ids on that port. Empty inner array = port exists but has no connection. The array's length determines the node's _declared_ output count.                                                                                                                 |
| `name`         | string       | no       | 0.x   | Visible label override. Some nodes (`debug`, `function`, `link*` in 3.0+) auto-generate a default name.                                                                                                                                                                                                         |
| `g`            | string       | no       | 2.1   | Group id this node belongs to. Single-value (a node can only be in one group at a time). v3.0 made `g` reserved-name (cannot be a node `defaults` key).                                                                                                                                                         |
| `d`            | boolean      | no       | 1.x   | "Disabled". Set by the editor's right-click → Disable. The runtime's diff treats `d: true` as _removed_.                                                                                                                                                                                                        |
| `l`            | boolean      | no       | 3.0   | "Show label". Only emitted for `link in`/`link out` nodes (defaults `false` for those, `true` for everything else, hence only serialized when explicit).                                                                                                                                                        |
| `info`         | string       | no       | 4.1   | Per-node markdown description; rendered as a tooltip badge in 4.1.0-beta.1+ (`#4955`).                                                                                                                                                                                                                          |
| `icon`         | string       | no       | 0.20  | Override icon. Example: `font-awesome/fa-bug`.                                                                                                                                                                                                                                                                  |
| `inputLabels`  | `string[]`   | no       | 0.20  | Hover labels for input ports.                                                                                                                                                                                                                                                                                   |
| `outputLabels` | `string[]`   | no       | 0.20  | Hover labels for output ports.                                                                                                                                                                                                                                                                                  |
| `_alias`       | string       | no       | 0.20  | **Subflow internal node only.** When the runtime materializes a subflow instance it clones the definition's nodes with new ids; the new node's `_alias` is the original definition-side id. Should never appear on top-level `flows.json` nodes; if it does, it's a bug in some other tool.                     |
| `_users`       | `string[]`   | runtime  | 0.x   | **Config nodes only.** Populated by the runtime at load time as the list of node ids that reference the config node. **Not persisted** by the editor — `parseConfig` initializes `flow.configs[n.id]._users = []` then back-fills. FlowOtter and other static tools should ignore it on read and never emit it. |
| `credentials`  | object       | no       | 0.x   | Inline credentials block. **Not persisted to `flows.json`** — credentials live in `flows_cred.json`. If you see it in `flows.json`, treat as a transient editor artifact.                                                                                                                                       |

#### Notable type-specific fields (registered by the node module, not the runtime)

- **`function`**: `outputs` (number) overrides implicit `wires.length`; `libs` (v1.3+); `timeout` (v4.1).
- **`link in`/`link out`/`link call`**: each carries `links: string[]` of symmetric peer ids. For `link out`, `parseConfig` rewrites `wires` from `links` — `wires` is informational; `links` is the source of truth. `link call` got dynamic routing (`target`/`linkType`/`msg.target`) in v3.0. `l: boolean` controls label visibility (default `false` for link nodes).
- **`catch`/`status`/`complete`**: `scope` is `string[]` of node-ids or `null` for "all". v3.1 added group-level scope.

### 2.5 Config nodes (no `z`, no `x`/`y`/`wires`)

A config node is identified _structurally_ by the absence of `x`/`y`. Some config nodes also live without `z` (global scope); others carry `z` to scope them to a tab/subflow.

```json
{
  "id": "cfg_mqtt_main",
  "type": "mqtt-broker",
  "name": "site-broker",
  "broker": "192.168.1.30",
  "port": 1883,
  "clientid": "",
  "autoConnect": true,
  "usetls": false,
  "protocolVersion": 4,
  "keepalive": 60,
  "cleansession": true
}
```

| Field                | Type       | Required | Since  | Notes                                                                                 |
| -------------------- | ---------- | -------- | ------ | ------------------------------------------------------------------------------------- |
| `id`                 | string     | yes      | 0.x    |                                                                                       |
| `type`               | string     | yes      | 0.x    | Registered config node type, e.g. `mqtt-broker`, `tls-config`, `ui_group`, `ui_base`. |
| `z`                  | string     | no       | 1.0    | If present, scopes the config node to a flow/subflow. If absent, global.              |
| `name`               | string     | no       | 0.x    | Display name.                                                                         |
| `d`                  | boolean    | no       | 1.x    | Disabled.                                                                             |
| `_users`             | `string[]` | runtime  | 0.x    | Built at load time; do not persist.                                                   |
| `credentials`        | object     | no       | 0.x    | Editor-only; do not persist.                                                          |
| Type-specific fields | varied     | varied   | varied | Whatever the registered config-node module defines.                                   |

**Identification rule from `parseConfig`**: a node entry is a config node iff `!hasOwnProperty('x') && !hasOwnProperty('y')` and is not a tab/subflow/group/comment/junction. The runtime puts it in `flow.configs[id]` (global) or `container.configs[id]` (scoped).

#### `global-config` config node (Node-RED 3.1+)

A specialized config node that holds global environment variables.

```json
{
  "id": "global_config_1",
  "type": "global-config",
  "env": [{ "name": "MQTT_HOST", "value": "192.168.1.30", "type": "str" }],
  "modules": {
    "node-red-contrib-influxdb": "0.7.0"
  }
}
```

The `modules` field, since v4.1.0-beta.1 (`#4599`), records the set of contrib modules a flow depends on, used by the editor's "Install all" feature. Pre-4.1 instances have no `modules`.

### 2.6 Group nodes (`type: "group"`)

A visual container that draws a colored rectangle around its `nodes`. Introduced in **Node-RED 2.1** (Sep 2021). Groups can be nested via `g`.

```json
{
  "id": "g_main",
  "type": "group",
  "z": "f1a2b3c4d5e6f708",
  "name": "MQTT bridge",
  "info": "Inbound MQTT to InfluxDB",
  "style": {
    "stroke": "#000000",
    "fill": "#a3c9a8",
    "label": true,
    "label-position": "nw",
    "color": "#1f2d3d"
  },
  "nodes": ["n_mqtt_in_1", "n_change_1", "n_influx_out_1"],
  "x": 60,
  "y": 60,
  "w": 480,
  "h": 200,
  "g": "g_outer",
  "env": [],
  "d": false
}
```

| Field           | Type       | Required | Since | Notes                                                                                                                                                |
| --------------- | ---------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | string     | yes      | 2.1   |                                                                                                                                                      |
| `type`          | `"group"`  | yes      | 2.1   |                                                                                                                                                      |
| `z`             | string     | yes      | 2.1   | Container id (tab or subflow def).                                                                                                                   |
| `name`          | string     | no       | 2.1   | Group label.                                                                                                                                         |
| `info`          | string     | no       | 2.1   | Markdown description.                                                                                                                                |
| `style`         | object     | no       | 2.1   | Visual styling. Common keys: `stroke`, `fill`, `label`, `label-position`, `color`.                                                                   |
| `nodes`         | `string[]` | yes      | 2.1   | Member node ids. **Single-value membership** — a node id appears in at most one group's `nodes`, mirrored in that node's `g`.                        |
| `x`,`y`,`w`,`h` | number     | no       | 2.1   | Auto-computed bounding box; the runtime's `diffNodes` filters them so they don't trigger redeploys. FlowOtter can omit them — the editor recomputes. |
| `g`             | string     | no       | 2.1   | Parent group id (group-in-group nesting).                                                                                                            |
| `env`           | array      | no       | 3.1   | Group-scoped env vars; visible to nodes inside the group via `${VAR}` substitution.                                                                  |
| `d`             | boolean    | no       | 2.1   | Disabled propagates to all children at runtime.                                                                                                      |

### 2.7 Comment nodes (`type: "comment"`)

A canvas-only annotation. No runtime behavior — `parseConfig` files it under the container.

```json
{
  "id": "c_note_1",
  "type": "comment",
  "z": "f1a2b3c4d5e6f708",
  "name": "Bridge inbound MQTT to InfluxDB.",
  "info": "## Notes\nThis flow handles...",
  "x": 120,
  "y": 40,
  "g": "g_main"
}
```

| Field   | Type        | Required | Since | Notes                                   |
| ------- | ----------- | -------- | ----- | --------------------------------------- |
| `id`    | string      | yes      | 0.x   |                                         |
| `type`  | `"comment"` | yes      | 0.x   |                                         |
| `z`     | string      | yes      | 0.x   | Tab/subflow id.                         |
| `name`  | string      | no       | 0.x   | Single-line title (rendered in canvas). |
| `info`  | string      | no       | 0.x   | Markdown body shown in info sidebar.    |
| `x`,`y` | number      | yes      | 0.x   | Canvas position.                        |
| `g`     | string      | no       | 2.1   | Group membership.                       |
| `d`     | boolean     | no       | 1.x   | Disabled — visual only.                 |

The runtime treats comment as a regular-shaped node structurally (it has `x`/`y`) so it lands in `container.nodes`; the editor renders it as a sticky note. FlowOtter's discriminator-by-`type` is correct.

### 2.8 Junction nodes (`type: "junction"`, Node-RED 3.0+)

A wire routing point — single-input, single-output. Wires into the junction terminate at its id; its `wires` array routes onward.

```json
{
  "id": "j1",
  "type": "junction",
  "z": "f1a2b3c4d5e6f708",
  "x": 320,
  "y": 200,
  "wires": [["n_downstream_debug"]],
  "g": "g_main"
}
```

Required: `id`, `type`, `z`, `x`, `y`, `wires` (always `[[targets]]`). Optional: `g`, `d`. All since 3.0.

**Discriminator gotcha.** A junction has `x`, `y`, `z`, and `wires`, matching the structural test for "regular node". The runtime treats it as no-op pass-through; it has no registered constructor. FlowOtter's `RESERVED_TYPES` should include `'junction'` to prevent agents authoring a fake node of `type: "junction"` with arbitrary passthrough.

## 3. Version timeline

Confirmed against `CHANGELOG.md` and runtime/flow-parser source.

| Version | Released         | Schema additions                                                                                                                                                                                               |
| ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.20    | Apr 2019         | `disabled` on tabs; `inputLabels`/`outputLabels`/`icon` on nodes; `env` on subflow def.                                                                                                                        |
| 1.0     | Sep 2019         | Config nodes can carry `z` for flow-scoping.                                                                                                                                                                   |
| 1.1     | Jul 2020         | `subflow.status` adds a status output port.                                                                                                                                                                    |
| 1.3     | Apr 2021         | `inject.props`; `function.libs`; `subflow.color`/`meta`; `link out.mode = "return"`; `link call`.                                                                                                              |
| 2.1     | Sep 2021         | **`type: "group"`** introduced; `g` field on workspace nodes; nested groups.                                                                                                                                   |
| 3.0     | Jul 2022         | **`type: "junction"`** introduced. `link call` dynamic routing via `msg.target`. `l` formalized for link nodes. Reserved-name list formalized: `x`,`y`,`z`,`d`,`g`,`l`,`id`,`type`,`wires`,`inputs`,`outputs`. |
| 3.1     | Sep 2023         | **`type: "global-config"`** config node. `env` on tab and group. `locked` on tab. `catch`/`status`/`complete` group-level scope. `NR_SUBFLOW_*` env vars. `conf-type` env-var type.                            |
| 4.0     | Jun 2024         | Inject timestamp formatting options. Flow-start performance refactor. No new top-level fields.                                                                                                                 |
| 4.1     | Apr 2025         | `info` on regular nodes (per-node annotation, `#4955`). `modules` on `global-config` (`#4599`). `function.timeout`.                                                                                            |
| 4.1.x   | through Apr 2026 | Bug-fix only. No on-disk schema additions.                                                                                                                                                                     |

Notes: the runtime never enforces a `version` field — the "schema version" is implicit in the runtime version. Junction was the last new top-level `type` discriminator. Pre-2.1, `g` did not exist; a 2.1+ flow opened in 2.0 silently loses group membership.

## 4. What FlowOtter's `src/shared/flows-json.ts` model probably misses

Reviewed: `src/shared/flows-json.ts`, `src/toolkit/authoring/{types,compile,decompile,builders}.ts`. The shared zod model is intentionally permissive (`.passthrough()`, `RESERVED_TYPES` check), so most "missing" fields _round-trip without loss_. The risk list below isolates the cases where silent passthrough hides correctness or security problems.

### High-risk (silently wrong runtime behavior or secrets exposure)

1. **No `junction` discriminator.** `RESERVED_TYPES = {tab, subflow, group, comment}` omits `junction` (3.0+). Agents calling `genericNode('junction', …)` would land in the regular-node branch with arbitrary passthrough; the editor re-canonicalizes on save and idempotency breaks on first round-trip. `decompile.ts` files existing junctions under `tab.nodes` rather than a dedicated bucket — survivable but conceptually wrong. Add `JunctionSpec`, `JunctionNodeSchema`, and `'junction'` to `RESERVED_TYPES`.

2. **`d` (node disabled) not surfaced.** The runtime keys `diffNodes`/deploy off `d` at the node level (distinct from tab-level `disabled`). `RegularNodeSchema` does not enumerate `d`; agents must hand-craft `passthrough.d = true`. Add explicit `disabled?: boolean` on `NodeSpec` (compile to `d`).

3. **`l` (link-label visibility) not surfaced.** Link nodes default `l: false`; non-link nodes default `l: true`. FlowOtter's `linkIn`/`linkOut` builders don't expose it. Round-trips via passthrough, but freshly authored link nodes follow whatever default the agent assumes.

4. **`info` missing on group/subflow-def/regular-node.** Currently on `TabSpec` and `CommentSpec` only. Add: `info` on `GroupSpec` (since 2.1), `SubflowDefSpec` (always), and `NodeSpec` (4.1+ tooltip annotation, `#4955`).

5. **Subflow definition underspecified.** `SubflowDefSchema` types `in`/`out`/`env` as `z.array(z.unknown())`. Cannot validate that `in[].wires[].id` references an internal node (common authoring mistake), nor that `env[]` entries are well-formed. Missing entirely: `meta` (module packaging), `status` (status port), `inputLabels`, `outputLabels`. Tighten to `{ x, y, wires: {id, port?}[] }[]` and a typed `env` array.

### Medium-risk gaps (round-trip works, but tooling is blind)

6. **`_users` is not stripped.** `STRUCTURAL_FIELDS` in `decompile.ts` does not include `_users`. The runtime _builds_ this list from `parseConfig` and writes it onto config nodes; the editor does not persist it. If FlowOtter reads runtime-loaded flows and re-emits, stale `_users` arrays survive. Recommend: add `_users` and `_alias` to `STRUCTURAL_FIELDS` (drop on read, never emit).

7. **`credentials` passthrough.** Should never appear in `flows.json` (storage splits to `flows_cred.json`); the decompiler doesn't strip it. A non-Node-RED tool writing `credentials` inline becomes a _secret leak_. Drop on read; never emit.

8. **`env` shape on tabs/subflows/groups.** Schema is `z.array(z.unknown())`. Actual shape: `{name, value, type, ui?}` with `type` ∈ `{str, num, bool, json, env, cred, jsonata, conf-type}`. Without typing, malformed env entries silently survive into deploy.

9. **`locked` on tab (3.1+) and `global-config` env/modules semantics (3.1/4.1).** Round-trips via passthrough; invisible to validators/lint.

### Low-risk gaps (cosmetic)

10. **Group `nodes` ordering.** Compiler does lexical sort (`containedIds.sort()`) which is idempotent but not editor-canonical (the editor sorts by canvas position). One-time resort on first editor save; no semantic change.

### Already correct (listed for clarity)

- `wires: string[][]` matches the runtime exactly.
- `type: "subflow:<id>"` matches the runtime's `/^subflow:(.+)$/`.
- Discriminator-by-`type` for tab/subflow/group/comment is correct (junction is the only missed reserved discriminator).
- `.passthrough()` is the right call for forward-compat with contrib node `defaults`.

### Recommended schema deltas

In priority order:

1. Add `'junction'` to `RESERVED_TYPES`; add `JunctionNodeSchema` and `JunctionSpec`.
2. Surface `disabled` as an explicit field on `NodeSpec` (compile to `d`).
3. Surface `info` on `NodeSpec`, `GroupSpec`, `SubflowDefSpec`.
4. Surface `l` (showLabel) on link-node builders.
5. Strip `_users` and `credentials` in `decompile.ts`'s `STRUCTURAL_FIELDS` (drop on read, never write).
6. Type `env[]` arrays as `{name, value, type, ui?}` with the closed type set.
7. Add `locked` to `TabNodeSchema`.
8. Tighten `subflow.in`/`subflow.out` shapes; add `meta`, `status`, `inputLabels`, `outputLabels` as typed fields.

None of these break the existing round-trip property (`passthrough` already covers them); they convert silent passthrough into validated, validator-visible structure.

## 5. References

- `packages/node_modules/@node-red/runtime/lib/flows/util.js` — `parseConfig`, `diffConfigs`, `diffNodes` (ground-truth loader).
- `packages/node_modules/@node-red/runtime/lib/flows/Subflow.js` — `_alias`, status-port wiring.
- `node-red/flow-parser` (`lib/NR*.js`) — official sibling package's interpretation of each field.
- `node-red/node-red` `CHANGELOG.md` — version timeline.
- `nodered.org/blog/2022/07/14/version-3-0-released` — junction.
- `nodered.org/blog/2023/09/06/version-3-1-released` — `global-config`, group/tab `env`, group-scope catch/status/complete.
- `nodered.org/docs/creating-nodes/properties` — reserved-name list.
