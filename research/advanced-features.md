# Node-RED Advanced Features Reference for FlowOtter

**Status**: research note, version-stamped 2026-05-08
**Node-RED versions surveyed**: 0.18 → 4.1.10 (latest at time of writing)
**Authoritative sources**: nodered.org/docs, node-red/node-red `CHANGELOG.md` on master, settings.js template at `packages/node_modules/node-red/settings.js`

Inventory of Node-RED features beyond the basic node/wire/tab model that an MCP-based authoring layer must round-trip correctly. Each section ends with "FlowOtter coverage" inspecting `src/toolkit/` and `src/server/tools/`. Where the docs do not pin a version, this note reaches into `CHANGELOG.md` and the dated release blogs.

---

## 1. Subflows

### Definition vs instance

Two distinct objects in `flows.json`:

- **Definition** — `type: "subflow"`, has `name`, optional `info`/`category`/`color`/`icon`, plus arrays `in[]`, `out[]`, optional `status` object, and `env[]`. Body nodes carry `z = <subflow def id>`. The definition has no canvas placement.
- **Instance** — a regular node whose `type` is `"subflow:<defId>"`. Has `z`, `x`, `y`, `wires`, optional `env[]` overrides, optional `name`. FlowOtter tracks this at `src/shared/flows-json.ts:14`.

Recursion is forbidden: a subflow cannot contain an instance of itself, directly or transitively (Node-RED docs, all versions ≥ 0.18).

### Input / output / status ports

- **Inputs**: `in: [{ x, y, wires: [{ id }] }]`. 4.1.x still caps at **one** input. The `wires` here points _into_ the subflow body via `id`; shape differs from a normal node. `in: []` is legal.
- **Outputs**: `out: [{ x, y, wires: [{ id, port }] }]`. Unlimited count. Each instance's top-level `wires: string[][]` must match `out.length` exactly. FlowOtter enforces this in `src/toolkit/validate/rules/subflow-ports.ts`.
- **Status**: optional `status: { x, y, wires: [{ id, port }] }`. Drives the instance's runtime status badge. Wires here trigger `node.status({...})` on the instance, not a separate output port.

### Environment variables (`env` / `envType`)

Subflow definitions and instances both carry an `env: Array<EnvEntry>`. Shape:

```json
{
  "name": "INTERVAL_MS",
  "type": "num",
  "value": "1000",
  "ui": {
    "label": { "en-US": "Interval (ms)" },
    "type": "input",
    "opts": { "types": ["num"] }
  }
}
```

Recognised `type` values (Node-RED 4.1.x; same set has been stable since 3.x except `conf-types` which was added in 4.0):

| envType      | Meaning                                     | Notes                                                                                            |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `str`        | Plain string                                | Default                                                                                          |
| `num`        | Number                                      | `value` is still stored as a string and parsed                                                   |
| `bool`       | Boolean                                     |                                                                                                  |
| `json`       | Parsed JSON literal                         |                                                                                                  |
| `bin`        | Buffer                                      |                                                                                                  |
| `env`        | Environment-variable reference (`${OTHER}`) |                                                                                                  |
| `jsonata`    | JSONata expression evaluated at flow start  |                                                                                                  |
| `cred`       | Encrypted credential                        | Lives in the `.flows_cred.json` sidecar; not in the spec                                         |
| `conf-types` | Reference to a config-node id               | Added in **4.0** (changelog 4.0.0-beta.1, "Support config selection in a subflow env var" #4587) |

Definition-level `env[]` declares the parameter contract (with `ui` for the editor); instance-level `env[]` overrides individual values. If an instance does not override a name, the definition's value is used.

**Built-in variables** (Node-RED 3.1, blog 2023-09-06):
`NR_SUBFLOW_NAME`, `NR_SUBFLOW_ID`, `NR_SUBFLOW_PATH` (plus the older `NR_NODE_*` and `NR_FLOW_*` from earlier versions). 4.1.1 added a fix (#5297) so `NR_SUBFLOW_PATH` resolves correctly when an instance is itself inside another subflow.

### Version timeline (subflow features)

| Version | Date       | Change                                                                                                                                                              |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.20    | 2019-03    | Subflow instance properties (env) introduced                                                                                                                        |
| 1.3     | 2021-02    | Module Properties (the foundation for subflow-as-module / packaged subflows)                                                                                        |
| 2.1     | 2021-10-21 | Flow- and group-level env vars (extends the subflow env model)                                                                                                      |
| 3.0     | 2022-07-14 | env autocomplete, `{{env.X}}` in Template node                                                                                                                      |
| 3.1     | 2023-09-06 | `NR_SUBFLOW_*` built-ins; env values evaluated at flow start, not on every message; deploy logic considers env diffs                                                |
| 4.0     | 2024-06-20 | `conf-types` envType — config-node selection per subflow instance; fixes packaged-subflow conf-type resaves (#4658); blank-string env substitutions allowed (#4672) |
| 4.1     | 2025       | Subflow color override fixes (#5599); per-subflow color caching fix (#5518); undo fix for output changes inside subflow (#5278)                                     |

### Scope rules

- Subflow body node `z` is the **definition id**, not the host tab. Decompilers bucketing by `z` must distinguish "tab z" from "subflow def z".
- Config nodes referenced by body nodes are global; pre-4.0 they could not be rebound per instance. With `conf-types`, the body node's config field is rewritten at flow-start to whichever config the instance points at.
- Status / Catch nodes inside a subflow are scoped to that subflow body unless their `scope` is set explicitly.

### FlowOtter coverage

- `SubflowDefSpec` (`src/toolkit/authoring/types.ts:73`) carries `id`, `name`, body `nodes`/`connections`, and a `passthrough` blob through which `in`, `out`, `status`, `env`, `category`, `color`, `icon` flow via `src/toolkit/authoring/compile.ts:189` (`emitSubflowDef`). Correct in shape but blunt — no structured fields have first-class typed surfaces. An agent has to hand-build `in[]/out[]/env[]` inside `passthrough` with no schema check.
- `addSubflowInstance` emits `type: "subflow:${defId}"` and accepts per-instance `env[]` overrides via `passthrough`. Wires sizing goes through `getOutputPortCount` (`types.ts:111`) which has **no special case for subflow instances** — it falls through to the default of 1. The compiler sizes `wires` to 1 regardless of `def.out.length`. The `subflow-ports` validator catches this _post_-compile.
- No envType validation. An invalid `type: "strring"` would silently round-trip.
- `get_subflow` (`src/server/tools/read/get-subflow.ts`) reads `def.in.length`/`def.out.length` and instance counts — read-only and correct.

**Gaps**: typed `subflowDef.ports.in/out/status`, typed `subflowDef.env[]` with envType enum, compiler sizing of subflow-instance `wires` from the referenced def, validator for envType domain.

---

## 2. Link nodes

Three node types: `link in`, `link out`, `link call`. **The string types contain a space — not an underscore**. FlowOtter gets this right (`src/toolkit/authoring/types.ts:101-102`).

### Wire-by-id

Link nodes don't appear in the regular `wires` graph; they use a parallel `links` array of node **ids** (the editor shows them by name but on-disk is always id):

```json
{ "id": "abc", "type": "link out", "links": ["def", "ghi"], "wires": [] }
```

FlowOtter's `link-resolution` validator (`src/toolkit/validate/rules/link-resolution.ts`) walks `links[]` and verifies each target exists and is the correct kind. Cross-tab is allowed — that's the whole point.

### Static vs dynamic (`linkType: "static" | "dynamic"`)

- **Static** (default): `links` is the resolved peer set.
- **Dynamic**: `linkType: "dynamic"`. Runtime routes by `msg.target` instead.
  - On `link out`: `msg.target` = target `link in` name. Duplicate names → runtime error.
  - On `link call`: `msg.target` = name or id. Id wins; duplicate names error.

Subflow-internal `link in` nodes cannot be reached from outside.

### `link call` semantics

Posts a message to a `link in`, waits for a `link out` with `mode: "return"` to send it back. Each `mode: "return"` pops the call stack. Properties:

- `links: [<one link in id>]` (validator-enforced)
- `linkType: "static" | "dynamic"`
- `timeout`: integer seconds (default 30, 4.x)

### Version timeline (link nodes)

| Version | Date       | Change                                                                        |
| ------- | ---------- | ----------------------------------------------------------------------------- |
| pre-1.0 | —          | `link in` and `link out` core nodes                                           |
| 2.1     | 2021-10-21 | `link call` node introduced, **static-only**                                  |
| 3.0     | 2022-07-14 | Dynamic mode (`linkType: "dynamic"`, `msg.target`) added to `link call`       |
| 3.0     | 2022-07-14 | Default unique names assigned to Debug, Function, **and Link** nodes          |
| 4.0     | 2024-06-20 | (no link-specific changes; CSV/HTTP/JSONata changes dominate)                 |
| 4.1.8   | 2025       | French-translation typo fix on link node description (#5530) — non-functional |

### FlowOtter coverage

- All three link types have add operations under `src/toolkit/authoring/operations/`.
- `link-resolution` validator covers existence, type-match (link-out → link-in, link-call → link-in, link-in → link-out|link-call), and the link-call-cardinality rule.
- **Gap**: no awareness of `linkType: "dynamic"`. The validator enforces the link-call-cardinality rule unconditionally; a dynamic link-call legitimately can have an empty/single `links` because routing is `msg.target`-driven. Won't fail-open today (it only inspects `links[]`) but won't catch dynamic-mode hazards either.
- **Gap**: no validator for "two link-in nodes with the same name" — breaks dynamic name resolution at runtime.
- **Gap**: `link call` `timeout` rides in `passthrough`; no range check.

---

## 3. Project Mode

### Status as of 4.1.x

Still gated behind `editorTheme.projects.enabled: false` in the shipped `settings.js` (master, line 438). The 0.18 blog called it "preview"; the docs dropped the word but the default-off posture has held seven years. Treat as stable-but-opt-in, not experimental.

### Settings shape

```js
editorTheme: {
  projects: {
    enabled: true,        // master switch
    workflow: {
      mode: "manual"      // or "auto" — manual requires explicit commit
    }
  }
}
```

Also togglable via `NODE_RED_ENABLE_PROJECTS=true` env var.

### What it changes

- `flowFile` no longer fixed; runtime reads `<userDir>/projects/<name>/flow.json` (+ `flow_cred.json`).
- Per-project `package.json` tracks dependencies independent of userDir's.
- `flow.json` is git-tracked; per-project `credentialSecret` encrypts the cred sidecar.

### Branches, remotes, hooks

- Editor's history sidebar surfaces local changes, commits, branches, remotes. Built-in SSH keygen requires `git` and `ssh-keygen` on `PATH` at Node-RED start.
- Auth: HTTPS basic, HTTPS PAT, SSH key.
- **No project-specific runtime hooks documented** — the §6 hooks API is global.
- The Admin API exposes `/projects/*` endpoints (list, current, branches, commits, remotes) but they're not in the published Admin Methods reference. Treat as undocumented-stable.

### Version timeline (Projects)

| Version | Date       | Change                                                                                                                                                                     |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.18    | 2018-10    | Projects feature introduced as preview; `editorTheme.projects.enabled` gate added                                                                                          |
| 1.0     | 2019-10    | "Projects" out of preview labelling per release blog, but still default-off                                                                                                |
| 4.0     | 2024-06-20 | Project-feature `package.json` dependency editor added in editor (#4676)                                                                                                   |
| 4.1.x   | 2025       | Stricter project-flow-file-name validator (#5398); race-condition fix in `gitTools.init()` (#5315); `4.1.10` (2026) ensures project files stay inside project root (#5724) |

### FlowOtter coverage

- **Zero coverage**. FlowOtter's flow source is filesystem-or-Admin-API (`src/adapters/flowsource/`). With Projects enabled the on-disk path is no longer literal `flows.json`.
- `admin-api` flow source is probably fine (`GET /flows` serialises the active project). `file` flow source pointed at `<userDir>/flows.json` silently reads a stale or nonexistent file when Projects is on.
- No tool surfaces "is Projects enabled" or "which project is active". No `/projects/*` integration.

**Gap**: an extension to `get_runtime_state` that reports `projectsEnabled` + active project name would prevent the silent-stale-file footgun.

---

## 4. settings.js — options FlowOtter might care about

Line numbers cite `packages/node_modules/node-red/settings.js` on master.

### Flow file & userDir

| Key                | Default                 | Notes                                                                                                                                                                                      |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flowFile`         | `'flows.json'`          | Default literal value in template (line 35); historic doc says `flows_<hostname>.json` is used when not set explicitly.                                                                    |
| `flowFilePretty`   | `true`                  | Pretty-prints the on-disk flow file. (line 50). Stable since 1.x.                                                                                                                          |
| `userDir`          | `$HOME/.node-red`       | Set by the runtime, not the template. Affects `nodes/`, `lib/`, `context/`, `projects/`.                                                                                                   |
| `nodesDir`         | `$HOME/.node-red/nodes` | Extra dir scanned for installed nodes.                                                                                                                                                     |
| `credentialSecret` | unset                   | Credential encryption key. If unset and no `_credentialSecret` is in `.config.runtime.json`, Node-RED autogenerates one and stores it locally. **Never ship a flow without knowing this.** |

### HTTP / web

| Key                      | Default                      | Notes                                                                       |
| ------------------------ | ---------------------------- | --------------------------------------------------------------------------- |
| `httpAdminRoot`          | `/`                          | `false` disables admin endpoints entirely.                                  |
| `httpNodeRoot`           | `/`                          | Mountpoint for HTTP-In flows.                                               |
| `httpStatic`             | unset                        | One or more static dirs. 3.1 added per-route middleware (#blog 2023-09-06). |
| `httpStaticCors`         | unset                        | **Added 4.0** (#4761).                                                      |
| `httpAdminCookieOptions` | unset                        | **Added 4.0** (#4718). Custom auth-cookie options.                          |
| `httpNodeAuth`           | unset                        | 4.0 accepts a single middleware or array (#4572).                           |
| `uiPort`                 | `process.env.PORT \|\| 1880` | Standalone only.                                                            |
| `uiHost`                 | `0.0.0.0`                    | Standalone only.                                                            |
| `https`                  | unset                        | Standalone only; turns on HTTPS for editor + Admin API.                     |

### Editor / theme

| Key                                          | Default              | Notes                                                                                 |
| -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `disableEditor`                              | `false`              | Disables the editor UI but keeps the Admin API.                                       |
| `editorTheme`                                | `{}`                 | The huge bag (palette categories, monaco/ace, mermaid toggle, multiplayer, projects). |
| `editorTheme.codeEditor.lib`                 | `"monaco"` since 3.0 | Was `"ace"` before; 3.0 release notes confirm the switch.                             |
| `editorTheme.markdownEditor.mermaid.enabled` | `true`               | Added 3.1.                                                                            |
| `editorTheme.multiplayer.enabled`            | `false`              | **Added 4.0** beta.2.                                                                 |
| `editorTheme.projects.enabled`               | `false`              | Project mode toggle. See §3.                                                          |

### Function / context

| Key                       | Default | Notes                                                               |
| ------------------------- | ------- | ------------------------------------------------------------------- |
| `functionGlobalContext`   | `{}`    | Objects merged into Function-node global scope.                     |
| `functionExternalModules` | `true`  | Allows `require` in Function nodes. Default-true since 3.0.         |
| `functionTimeout`         | `0`     | Per-node timeout default (0 = none).                                |
| `globalFunctionTimeout`   | `0`     | Global override.                                                    |
| `contextStorage`          | unset   | See §8.                                                             |
| `exportGlobalContextKeys` | `false` | Whether `global.keys()` enumerates `functionGlobalContext` entries. |

### Logging / diagnostics / runtime state

| Key                       | Default  | Notes                                                        |
| ------------------------- | -------- | ------------------------------------------------------------ |
| `logging.console.level`   | `"info"` | `fatal\|error\|warn\|info\|debug\|trace\|off`                |
| `logging.console.metrics` | `false`  |                                                              |
| `logging.console.audit`   | `false`  |                                                              |
| `diagnostics.enabled`     | `true`   | **Added 3.0**. Set to `false` to disable `GET /diagnostics`. |
| `diagnostics.ui`          | `true`   | Whether the editor `show-system-info` action is exposed.     |
| `runtimeState.enabled`    | `false`  | **Added 3.0**. Required for `/flows/state` POST to work.     |
| `runtimeState.ui`         | `false`  | Whether editor exposes start/stop flows actions.             |

### Palette / external modules

| Key                                    | Default | Notes                                       |
| -------------------------------------- | ------- | ------------------------------------------- |
| `externalModules.autoInstall`          | `false` | Auto-install missing nodes on flow load.    |
| `externalModules.palette.allowInstall` | `true`  | Palette manager install permission.         |
| `externalModules.palette.allowUpload`  | `true`  | tgz upload permission.                      |
| `externalModules.modules.allowInstall` | `true`  | Function-node `require` install permission. |

### FlowOtter coverage

- FlowOtter does **not parse `settings.js`**. `GET /settings` via `NodeRedClient.getSettings()` returns only `httpNodeRoot`, `version`, `user`. The fields that matter (Projects on/off, runtimeState on/off, flowFile, contextStorage, palette permissions) are not there. They live in `GET /diagnostics` or in `settings.js` itself.
- `get_runtime_state` does call `getDiagnostics()` — correct.
- **Gap**: no tool reports flowFile, userDir, projects.enabled.
- **Gap**: no awareness of `flowFilePretty`. `canonicalHash` is whitespace-invariant in memory, but a runtime with `flowFilePretty: false` writing back through Node-RED would normalise differently and could spuriously trip drift detection on a `file` flow source.

---

## 5. Runtime state controls

### `/flows/state` GET and POST

Both require `runtimeState.enabled: true` in `settings.js`. Source-of-truth from `runtime/lib/api/flows.js`:

```js
state: 'start' | 'stop'; // only valid POST inputs
```

Doc surface uses present-tense `start`/`stop`, not past-tense `started`/`stopped` that some blog posts used. `getRuntimeStateTool` passes through whatever the runtime sends.

### Safe mode

Triggered via the `--safe` CLI flag, **not** via `/flows/state`. `runtime.settings.safeMode` is a boolean cleared inside `setState({state:"start"})` after which `startFlows("full")` runs. Canonical exit: editor deploy (which implicitly starts) or `POST /flows/state {state: "start"}` (requires `runtimeState.enabled`).

### State semantics

| State     | Meaning                             | Triggered by                                                                       |
| --------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `start`   | Flows running                       | Default at boot; `POST /flows/state {state:"start"}`; deploy with safeMode cleared |
| `stop`    | Flows loaded but not running        | `POST /flows/state {state:"stop"}`                                                 |
| safe-mode | Flows loaded, not running, editable | `node-red --safe`; cleared by any `start`                                          |

**No started/stopped/safeMode trichotomy in the API.** Safe mode is orthogonal to `start`/`stop`. The runtime carries both `runtimeFlowState` and `safeMode`. Booting safe + POST `stop` → flows stay stopped _and_ safe mode clears.

### Persistence across restarts

3.0 release blog: "the runtime can remember the state of flows so they stay in the same started/stopped state when Node-RED restarts." Stored as `runtimeFlowState` in `.config.runtime.json` under userDir.

### Version timeline

| Version | Date       | Change                                                                                                 |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 0.20    | 2019-03    | `--safe` CLI flag introduced                                                                           |
| 3.0     | 2022-07-14 | `runtimeState.enabled` setting; `/flows/state` GET + POST; UI start/stop buttons via `runtimeState.ui` |
| 3.x→4.x | —          | No semantic changes to the state API                                                                   |

### FlowOtter coverage

- `get_runtime_state` returns `state` + `diagnostics`. Does **not** distinguish safe-mode from "stopped" — `/flows/state` returns `start`/`stop` regardless of safe mode. Safe mode is in the diagnostics blob (3.x+ includes `runtime.safeMode`).
- No tool POSTs to `/flows/state`. `replace_flows` and `reset_runtime` overwrite flows but don't toggle runtime state — on a stopped runtime they'd deploy without starting.
- **Gap**: no `start_flows` / `stop_flows` tool. For safe rollout (snapshot → stop → deploy → verify config init → start) FlowOtter can't do the stop/start steps today.

---

## 6. Hooks

Two surfaces, both registered inside the Node-RED process via `RED.hooks.add(name, handler)`.

**Messaging hooks** (1.1+, expanded since):

`onSend`, `preRoute`, `preDeliver`, `postDeliver`, `onReceive`, `postReceive`, `onComplete`.

**Install hooks** (2.x, formalised in 3.x):

`preInstall(event)`, `postInstall(event, done?)`, `preUninstall(event)`, `postUninstall(event)`. `installEvent` = `{ module, version, url, dir, isExisting, isUpgrade, args }`. `uninstallEvent` = `{ module, dir, args }`.

**No documented `onAdd`/`onStart`/`onStop` runtime hook** in the public API. Those names appear in editor-side code (`nodes:add`) but the docs explicitly state the editor hooks API is "less mature so not currently documented for general use." Treat editor hooks as private.

### MCP exposure

**None of these hooks are exposed via the Admin API.** They live in-process and require a Node-RED plugin or settings.js handler. From an MCP's perspective, hooks are a runtime extension surface, not a client surface.

Event-ish surfaces an external MCP can pull or peek at:

- The Comms WebSocket (`/comms`) — undocumented for external use; subject to change.
- `GET /diagnostics` — pull-only snapshot.
- Runtime audit log (with `logging.console.audit: true`) — stdout only.

### Version timeline (hooks)

| Version | Date       | Change                                                                                                |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| 1.1     | 2020-01    | Messaging hooks (preDeliver / postDeliver introduced)                                                 |
| 2.0     | 2021-07    | onSend, preRoute, onReceive, postReceive, onComplete added                                            |
| 3.0     | 2022-07-14 | Install hooks made part of the public API                                                             |
| 3.1     | 2023-09-06 | Issue #4383 fix for `RED.hooks` being null in some plugin contexts                                    |
| 4.1.6   | 2025       | Frontend pre/post debug message hooks added (#5495) — editor-side, still not "general use" documented |

### FlowOtter coverage

- FlowOtter correctly doesn't pretend to subscribe to hooks.
- **Implicit gap**: no doc anywhere saying "for event-driven behaviour you need a Node-RED plugin alongside, not an MCP." Worth a paragraph in `docs/ARCHITECTURE.md`.

---

## 7. Custom node packaging

### `package.json` `node-red` block

```json
{
  "name": "node-red-contrib-foo",
  "version": "1.2.3",
  "node-red": {
    "version": ">=3.0.0",
    "nodes": {
      "foo-action": "lib/foo-action.js",
      "foo-config": "lib/foo-config.js"
    },
    "plugins": {
      "foo-plugin": "lib/foo-plugin.js"
    }
  },
  "keywords": ["node-red"],
  "dependencies": { ... }
}
```

- `node-red.nodes` — map of node-set name → js file. Multiple node types per file is fine.
- `node-red.version` — semver range gating which Node-RED versions can load this module. **Stable since 1.0; honoured by the runtime since 2.x** (older versions load and warn).
- `node-red.plugins` — same shape as `nodes`, for plugin-only modules. **Added 4.0** (#4620 in 4.0.0-beta.2: "Add support for plugin (only) modules to the palette manager").
- The `node-red` keyword in `package.json` is what makes the module _discoverable_ via npm search and the public flow library. As of 4.x manual submission to flows.nodered.org is required regardless.

### Discovery

Runtime scans on start: `<userDir>/node_modules/` (palette-installed; `POST /nodes` lands here), `<nodesDir>`, the Node-RED installation. A package is recognised iff `package.json` has a `node-red` block.

### Palette manager API

- `GET /nodes` → array of NodeSet objects: `{ id, name, types[], enabled, module, version }`.
- `GET /nodes/:module` → details for a single module.
- `POST /nodes` → install. Body `{ "module": "<name>" }` (npm) or `multipart/form-data` tgz upload (tgz added 1.0; 4.1.10 hardened name validation, #5722).
- `PUT /nodes/:module` → enable/disable.
- `PUT /nodes/:module/:set` → enable/disable a single node-set within a multi-set module.
- `DELETE /nodes/:module` → uninstall.

`externalModules.palette.allowInstall: false` blocks the mutating endpoints.

### Version constraints

The GET response carries the npm-installed `version` string. No version-range query; MCPs comparing ranges must parse themselves. FlowOtter's `list_installed_node_types` returns raw modules.

### FlowOtter coverage

- `list_installed_node_types` calls `GET /nodes` and returns the raw response. Agents must walk the module list themselves to check "is X installed".
- No `POST /nodes` wrapper. **Intentional** — installing packages remotely is near-RCE, correct per FlowOtter's read-only-by-default rule.
- **Gap**: no validator for "spec uses `mqtt-broker` but `node-red-contrib-mqtt-broker` isn't installed". With `list_installed_node_types` already wired, a `node-type-availability` validator is cheap.
- Contrib-module node types (`ui_button`, `serialport`, etc.) are passed through untyped via `passthrough` — right design, but FlowOtter cannot validate passthrough contents against the contrib's schema.

---

## 8. Context storage

### Scopes

Three scopes via function-node `node.context()`:

1. **Node** — visible only to that node instance.
2. **Flow** — `context().flow` — visible to all nodes on the same tab. Inside subflows, scoped to the subflow instance (since 1.x).
3. **Global** — `context().global` — everywhere.

### Persistence backends

- `memory` — default; cleared on restart.
- `localfilesystem` — JSON files under `<userDir>/context/`. Optional `flushInterval` (default 30s).
- Custom modules — implement `open/close/get/set/keys/delete`.

### `contextStorage` config shape

```js
contextStorage: {
  default: { module: "localfilesystem" },
  fast: { module: "memory" },
  redis: { module: "node-red-context-redis", config: { host, port } }
}
```

If `default` is unset, behaviour falls back to memory. Stores can be referenced by name in the Function node's `context().get("foo", "redis")`.

### Admin API exposure

**Context is not exposed via the Admin API.** No `/context` endpoint in 4.1.x. External readers either watch the Comms WebSocket debug feed (best-effort) or have the runtime publish via a Function node + MQTT/HTTP. Intentional — global context can hold credentials.

### Version timeline

| Version | Date    | Change                                                                    |
| ------- | ------- | ------------------------------------------------------------------------- |
| 0.19    | 2018-08 | `contextStorage` settings.js property; pluggable backends                 |
| 1.0     | 2019-10 | Subflow context isolation: subflow instance gets its own flow context     |
| 1.x     | —       | Async context API stabilised                                              |
| 4.1.4   | 2025    | Race condition in localfilesystem context store on shutdown fixed (#5462) |

### FlowOtter coverage

- **Zero direct coverage**, by design.
- `get_runtime_state` returns diagnostics, which on 3.0+ includes configured context stores — agents can ask indirectly.
- **Implicit gap**: no validator for "function node calls `context.get('x', 'redis')` where `redis` isn't configured". Would require parsing settings.js. Out-of-scope, not missing feature.

---

## Cross-cutting summary for FlowOtter roadmap

Concrete gaps surfaced by this review, ranked by risk:

| Risk   | Item                                                                                    | Source |
| ------ | --------------------------------------------------------------------------------------- | ------ |
| High   | Compiler does not size subflow-instance `wires` from `def.out.length`                   | §1     |
| High   | No drift detection when Projects mode is enabled and FLOW_SOURCE=file                   | §3     |
| Medium | No envType domain validator on subflow `env[]`                                          | §1     |
| Medium | Dynamic-mode link nodes not understood by `link-resolution` validator                   | §2     |
| Medium | No `start_flows` / `stop_flows` MCP tool — can't safely roll out via stop+deploy+start  | §5     |
| Low    | No node-type-availability validator (use of `mqtt-broker` without the module installed) | §7     |
| Low    | No documented "settings.js is not introspected; use diagnostics instead" caveat         | §4     |

The ordering here is roughly: things that produce silently wrong `flows.json`, then things that produce surprises against the runtime, then nice-to-haves.
