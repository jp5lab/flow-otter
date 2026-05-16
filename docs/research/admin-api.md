# Node-RED Admin API — Endpoint Catalog

**Compiled:** 2026-05-08 (research date).
**Coverage target:** Node-RED 0.15 → 5.0.0-beta.6.
**Reference target for FlowOtter:** **4.1.x** (current LTS-equivalent maintenance line — 4.1.0 shipped 2025-07-29; 4.1.10 is the latest as of 2026-05-08).
**Beta in flight:** 5.0.0-beta.6 (2026-04-30).

Every endpoint listed is verified against the upstream source in `packages/node_modules/@node-red/editor-api/lib/admin/` (route table at `lib/admin/index.js`, plus per-handler files). Where a claim about behavior comes from the public docs, the source is named inline. Where a version claim is inferred from `git log` of the route file, that is flagged.

> **Methodology note.** Many of the API method docs on nodered.org are **undated and unversioned** — the docs page lists endpoints without "introduced in vX.Y" markers (the only one is the `Node-RED-API-Version` header, "_Since 0.15.0_"). For version stamping I cross-referenced the `git log` of each handler file in `node-red/node-red` against the release tag dates and the per-version blog posts (`nodered.org/blog/...`). Anywhere a stamp is purely from `git log` and not also confirmed by a blog post, it is annotated as `(source: git log, blog post does not call out)`.

---

## 1. Endpoint inventory (one row each)

All paths are relative to `httpAdminRoot` (defaults to `/`, but installations like Home Assistant mount Node-RED under a prefix — FlowOtter must let the operator set the base URL).

| #   | Method      | Path                                | Permission         | Introduced                                                                                                                                                                    | Notes                                                                                                                                                          |
| --- | ----------- | ----------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GET         | `/auth/login`                       | none               | <= 0.10                                                                                                                                                                       | Returns `{}` (no auth), `{type:"credentials",prompts:[…]}`, or strategy-redirect form.                                                                         |
| 2   | POST        | `/auth/token`                       | none               | <= 0.10                                                                                                                                                                       | OAuth-2 password grant. Returns Bearer token + `expires_in: 604800` (7 days).                                                                                  |
| 3   | POST        | `/auth/revoke`                      | Bearer             | <= 0.10                                                                                                                                                                       | Body `token=…`.                                                                                                                                                |
| 4   | GET         | `/auth/strategy`                    | none               | configurable                                                                                                                                                                  | Only mounted when `adminAuth.strategy` is set (passport SAML/OAuth).                                                                                           |
| 5   | GET or POST | `/auth/strategy/callback`           | none               | configurable                                                                                                                                                                  | Method = `strategy.callbackMethod` (default GET). 5.0.0-beta.6 (PR #5657, 2026-04-25) replaced direct token issue with a 20-second one-shot exchange code.     |
| 6   | GET         | `/settings`                         | `settings.read`    | <= 0.10                                                                                                                                                                       | Public-safe runtime settings (NOT `settings.js`).                                                                                                              |
| 7   | GET         | `/diagnostics`                      | `diagnostics.read` | **3.0** (commit 3388f69, 2022-03-24; shipped 3.0.0 2022-07-14)                                                                                                                | Returns 403 `{code:"diagnostics.disabled"}` when `settings.diagnostics.enabled === false`.                                                                     |
| 8   | GET         | `/flows`                            | `flows.read`       | <= 0.10 (v2 shape: 0.15)                                                                                                                                                      | Honors `Node-RED-API-Version: v1\|v2`. v1 = bare array, v2 = `{rev, flows}`.                                                                                   |
| 9   | POST        | `/flows`                            | `flows.write`      | <= 0.10                                                                                                                                                                       | Honors `Node-RED-API-Version` and `Node-RED-Deployment-Type`. v2 returns 200 `{rev}`; v1 returns 204. v2 returns 409 on rev mismatch.                          |
| 10  | GET         | `/flows/state`                      | `flows.read`       | **3.0** (commit 68331fc, 2022-06-08)                                                                                                                                          | `{state:"start"\|"stop"}`. Always mounted in 3.x+ (read is always available).                                                                                  |
| 11  | POST        | `/flows/state`                      | `flows.write`      | **3.0** (same commit; route gated)                                                                                                                                            | **Only mounted when `settings.runtimeState.enabled === true`.** Body `{"state":"start"\|"stop"}` (JSON, since 2f1f587 2022-06-27 it is HTTP body, not header). |
| 12  | POST        | `/flow`                             | `flows.write`      | **0.19** (commit e57d8ba, 2018-08-17)                                                                                                                                         | Body must contain `nodes` array; runtime assigns a new flow `id`. Returns `{id}`.                                                                              |
| 13  | GET         | `/flow/:id`                         | `flows.read`       | **0.19**                                                                                                                                                                      | `:id = "global"` returns `{id:"global", configs, subflows}`.                                                                                                   |
| 14  | PUT         | `/flow/:id`                         | `flows.write`      | **0.19**                                                                                                                                                                      | Returns 204. Body shape mirrors GET response.                                                                                                                  |
| 15  | DELETE      | `/flow/:id`                         | `flows.write`      | **0.19**                                                                                                                                                                      | Returns 204.                                                                                                                                                   |
| 16  | GET         | `/nodes`                            | `nodes.read`       | <= 0.10                                                                                                                                                                       | Content-negotiated: `Accept: application/json` → metadata array; otherwise → concatenated HTML for editor.                                                     |
| 17  | POST        | `/nodes`                            | `nodes.write`      | <= 0.10                                                                                                                                                                       | Body `{module, version?, url?}` OR `multipart/form-data` with `tarball`. Suppressed entirely when `externalModules.palette.allowInstall === false`.            |
| 18  | GET         | `/nodes/messages`                   | `nodes.read`       | 0.20 (i18n catalog refactor)                                                                                                                                                  | Returns all loaded i18n catalogs. Lang via `Accept-Language`.                                                                                                  |
| 19  | GET         | `/nodes/:module/:set/messages`      | `nodes.read`       | 0.20                                                                                                                                                                          | Per-set i18n catalog.                                                                                                                                          |
| 20  | GET         | `/nodes/:module`                    | `nodes.read`       | <= 0.10                                                                                                                                                                       | Module info object. Regex route — supports `@scope/pkg`.                                                                                                       |
| 21  | PUT         | `/nodes/:module`                    | `nodes.write`      | <= 0.10                                                                                                                                                                       | Body `{enabled: bool}`. Returns updated module info.                                                                                                           |
| 22  | DELETE      | `/nodes/:module`                    | `nodes.write`      | <= 0.10                                                                                                                                                                       | Returns 204.                                                                                                                                                   |
| 23  | GET         | `/nodes/:module/:set`               | `nodes.read`       | <= 0.10                                                                                                                                                                       | Content-negotiated like `/nodes`.                                                                                                                              |
| 24  | PUT         | `/nodes/:module/:set`               | `nodes.write`      | <= 0.10                                                                                                                                                                       | Body `{enabled: bool}`. Returns Node Set.                                                                                                                      |
| 25  | GET         | `/context/global`                   | `context.read`     | **0.19**                                                                                                                                                                      | Optional `?store=…&keysOnly` query.                                                                                                                            |
| 26  | GET         | `/context/global/*`                 | `context.read`     | **0.19**                                                                                                                                                                      | Path tail = key (supports nested keys).                                                                                                                        |
| 27  | GET         | `/context/:scope(node\|flow)/:id`   | `context.read`     | **0.19**                                                                                                                                                                      |                                                                                                                                                                |
| 28  | GET         | `/context/:scope(node\|flow)/:id/*` | `context.read`     | **0.19**                                                                                                                                                                      |                                                                                                                                                                |
| 29  | DELETE      | `/context/global/*`                 | `context.write`    | **0.19**                                                                                                                                                                      | 204 on success. **Note**: deleting the entire global scope (no key) is wired in source but commented out — must specify a key.                                 |
| 30  | DELETE      | `/context/:scope(node\|flow)/:id/*` | `context.write`    | **0.19**                                                                                                                                                                      | Same caveat.                                                                                                                                                   |
| 31  | GET         | `/plugins`                          | `plugins.read`     | **2.1** (commit a006b52, 2020-12-10)                                                                                                                                          | Content-negotiated: JSON returns plugin list; HTML returns concatenated plugin configs.                                                                        |
| 32  | GET         | `/plugins/messages`                 | `plugins.read`     | **2.1**                                                                                                                                                                       | i18n catalogs for plugins; lang via `?lng=…`.                                                                                                                  |
| 33  | GET         | `/plugins/:module`                  | `plugins.read`     | **3.1** (commit 81937dd, 2023-10-17) — added with palette manager plugin support; shipped in **3.1.0** (2023-09-06).                                                          | Module info; enabled by `Add plugin support to palette manager`.                                                                                               |
| 34  | GET         | `/plugins/:module/:set`             | `plugins.read`     | **3.1** (same commit), with split refactor in **4.1.x maint** (commit b93582f, 2025-09-30 — `Splits the logic into two routes`; shipped in 4.1.2 / 4.1.3 maintenance window). | Per-plugin config; JSON returns metadata, HTML returns plugin UI.                                                                                              |

**That is the complete catalog mounted by `editor-api/lib/admin/index.js`.** There are no other admin routes — `/projects`, `/locales/...`, `/icons/...`, `/library/...`, `/comms` (websocket), and `/red/...` (editor static assets) are mounted from a **different** Express app (the editor app, not the admin app) and are explicitly out of scope for this catalog. FlowOtter should not need them.

---

## 2. Per-endpoint detail (non-trivial only)

### 2.1 Auth: GET `/auth/login`, POST `/auth/token`, POST `/auth/revoke`

**Source:** `editor-api/lib/auth/index.js`. Docs: <https://nodered.org/docs/api/admin/oauth>.

GET `/auth/login` returns one of three shapes:

```json
// no adminAuth configured
{}

// adminAuth.users / .credentials configured
{ "type": "credentials",
  "prompts": [
    { "id":"username", "type":"text", "label":"Username" },
    { "id":"password", "type":"password", "label":"Password" }
  ] }

// adminAuth.strategy (passport SAML/OAuth) configured
{ "type":"strategy",
  "loginRedirect": "<httpAdminRoot>auth/strategy",
  "prompts":[ { "type":"button", "label":"<strategy.label>", "url":"<httpAdminRoot>auth/strategy" } ] }
```

POST `/auth/token` (form-encoded):

- `client_id` MUST be `node-red-admin` or `node-red-editor` (other values 400).
- `grant_type` MUST be `password`.
- `scope` MUST be `*` or `read` (space-separated list, but only those two literals are accepted by core).
- `username`, `password`.

Response: `{access_token, token_type:"Bearer", expires_in:604800}`. **The 7-day TTL is hard-coded** in `editor-api/lib/auth/tokens.js` and not configurable via settings — FlowOtter must refresh tokens periodically.

POST `/auth/revoke` (form-encoded `token=…`, plus `Authorization: Bearer …`). Returns 200 with no body on success.

**5.0.0-beta.6 change (PR #5657, 2026-04-25):** strategy callbacks no longer return the access token in the redirect URL — they return a 20-second, single-use **exchange code** that is then exchanged for the token via a follow-up POST. This **only affects** SAML/OAuth strategies, not the `password` grant. FlowOtter, which uses the `password` grant, is unaffected — but the doc on `/auth/strategy/callback` is wrong for 5.x.

---

### 2.2 GET `/flows`, POST `/flows` — version-sensitive

**Source:** `editor-api/lib/admin/flows.js` (handler) + `runtime/lib/api/flows.js` (logic). Docs: `/docs/api/admin/methods/get/flows/` and `…/post/flows/`.

The `Node-RED-API-Version` request header selects v1 vs v2. `v1` is the default if the header is missing (per source `req.get("Node-RED-API-Version")||"v1"`). **Since 0.15.0** (per the docs page).

| Aspect                | v1                         | v2                                                                |
| --------------------- | -------------------------- | ----------------------------------------------------------------- |
| GET `/flows` body     | bare array of node objects | `{rev: string\|null, flows: [...]}`                               |
| POST `/flows` body    | bare array                 | `{flows:[...], rev?:string, credentials?:{...}}`                  |
| POST `/flows` success | 204 No Content             | 200 with body `{rev:"<new-rev>"}`                                 |
| POST `/flows` 409     | not emitted                | emitted on rev mismatch; body is `{code:"version_mismatch", ...}` |

**`Node-RED-Deployment-Type` header** (POST `/flows`):

- `full` (default): stop everything, restart with new config.
- `nodes`: only restart modified nodes.
- `flows`: only restart flows containing modified nodes.
- `reload`: ignore the request body — **reload from storage**. _(Since 0.12.2 per docs.)_ When `deploymentType==="reload"`, source skips reading the body entirely.

**Invalid version** (anything other than `v1` or `v2` against the regex `^v[12]$`) → 400 `{code:"invalid_api_version"}`.

**FlowOtter today** (`src/adapters/nodered/client.ts`): correctly sends `Node-RED-API-Version: v2` on both. The 409 handler reads `parsed.rev`, but the actual 409 body in source is `{code, message, ...}` from `apiUtils.rejectHandler` — the `rev` field on 409 is **not guaranteed**; it is included only when the runtime API rejects via the `version_mismatch` code with the runtime's actual rev attached. This is an undocumented quirk; expect occasional `actualRev === undefined`.

---

### 2.3 GET `/flows/state`, POST `/flows/state`

**Introduced in 3.0** (commit `68331fc` 2022-06-08; the 3.0 release blog at <https://nodered.org/blog/2022/07/14/version-3-0-released> explicitly lists this as a flagship feature: "the optional ability to run Node-RED without the flows themselves running").

**GET is always mounted in 3.0+**, but **POST is only mounted when `settings.runtimeState.enabled === true`** — see `editor-api/lib/admin/index.js`:

```js
adminApp.get("/flows/state", needsPermission("flows.read"), flows.getState, …);
if (settings.runtimeState && settings.runtimeState.enabled === true) {
    adminApp.post("/flows/state", needsPermission("flows.write"), flows.postState, …);
}
```

**Behavior diff vs docs:** the public docs at `/docs/api/admin/methods/get/flows/state/` claim "_runtime state of flows is available only if `runtimeState` value is set to `enabled: true`_". This is **only true for POST**. GET is mounted unconditionally and returns `{state:"start"}` (always) when `runtimeState` is disabled. FlowOtter can safely call GET against any 3.0+ Node-RED.

**Body change:** the very first cut (commit `68331fc`, 2022-06-08) used a request **header** for the state value. By commit `2f1f587` (2022-06-27, three weeks later, still pre-release) it became a JSON body `{"state":"start"|"stop"}`. **Anything 3.0.0 or later uses the body form** — the header form never shipped in a release.

---

### 2.4 GET `/diagnostics`

**Introduced in 3.0** (commit `3388f69` 2022-03-24; explicit announcement in 3.0 blog: "We've added a new admin endpoint that returns information about the runtime and the system its running on").

**Disabled-state behavior:** when `settings.diagnostics.enabled === false`, source returns **403** `{code:"diagnostics.disabled", message:"diagnostics are disabled", status:403}`. The public docs do **not** document this — the 403/disabled path is only visible in source (`editor-api/lib/admin/diagnostics.js`).

**Scope levels:** `settings.diagnostics.level` (default `"basic"`) controls how much detail is in the report. Not currently used by core but available to handlers.

**Response shape** (all keys, from docs page):

```
{ report, scope, time:{utc, local}, intl:{locale, timeZone},
  nodejs:{version, arch, platform, memoryUsage:{...}},
  os:{containerised, wsl, totalmem, freemem, arch, loadavg, platform, release, type, uptime, version},
  runtime:{version, isStarted, flows:{state, started}, modules:{...}, settings:{...}} }
```

**FlowOtter today** treats this as `Record<string, unknown>` — fine, but worth knowing the response can be 403 (currently caught by `httpError` and surfaced as a `NodeRedHttpError`).

---

### 2.5 Single-flow CRUD: POST `/flow`, GET/PUT/DELETE `/flow/:id`

**Introduced in 0.19** (per `git log` on `editor-api/lib/admin/flow.js` — earliest commit 2018-08-17, before 0.19.0 shipped 2018-08-14; technically commit lands on master before tag, this is the **0.19-era** introduction).

These let an agent mutate one flow tab without round-tripping the full `/flows` document — the right shape for FlowOtter's incremental authoring model.

**POST `/flow` quirks** (verified in source `editor-api/lib/admin/flow.js` and runtime):

- Only `nodes` is mandatory. `id`, `label`, `configs`, `subflows` are optional.
- The runtime **always assigns a new `id`** and overwrites any provided `id`. Each node's `z` (parent flow) is also rewritten to match the new flow id. FlowOtter must therefore not depend on round-tripping its own `id` through POST `/flow` — it must read the response and remap.
- All node IDs in the body must be unique across the runtime — duplicates cause rejection (400).
- Returns **`{id}`** (NOT 204 as some docs pages suggest — the POST `/flow` page says "204 - Success (no content returned)" but the code does `res.json({id:newId})` after a 200; this is a docs-vs-code mismatch).

**GET `/flow/global`** is the special form — returns `{id:"global", configs, subflows}` and is the ONLY way to read global config nodes + subflow definitions individually. FlowOtter doesn't currently call this and probably should.

---

### 2.6 GET `/nodes` and POST `/nodes` — content-negotiation gotcha

**Source:** `editor-api/lib/admin/nodes.js`.

GET `/nodes` is **content-negotiated** on the `Accept` request header:

- `Accept: application/json` → JSON array of Node Set metadata (what FlowOtter wants).
- **anything else** → concatenated HTML of every node's editor template.

FlowOtter currently sends `Accept: application/json` — correct.

POST `/nodes` accepts **two body modes**:

- `Content-Type: application/json` body `{module, version?, url?}` — install from npm registry.
- `Content-Type: multipart/form-data` field `tarball` — install from a .tgz upload.

**Suppression flags** (settings.js):

- `externalModules.palette.allowInstall === false` → POST `/nodes` is **not mounted at all** (404).
- `externalModules.palette.allowUpload === false` → multer is not loaded; POST `/nodes` only accepts JSON.
- `editorTheme.palette.upload === false` → POST runs but ignores the uploaded tarball (handler-level check).

POST `/nodes` returns the installed module info object on 200; FlowOtter doesn't currently call this — relevant if the agent ever needs to install a contrib node it depends on.

**4.1.10 (2026-05-08) maintenance fix** (`#5722` "Fix module name validation for uninstall and tgz install") tightens module-name validation on this endpoint. Pre-4.1.10 had a parsing bug for scoped tgz module names — FlowOtter integration tests should target 4.1.10+ to avoid the bug.

---

### 2.7 PUT `/nodes/:module` and PUT `/nodes/:module/:set` — disable/enable

Body must be **valid JSON** `{"enabled": true}` or `{"enabled": false}`. Common quirk reported on Discourse: sending `enabled` as a string `"true"` is silently coerced and works, but **omitting the field** returns a 400. Returns the updated Node Module / Node Set. FlowOtter doesn't use these — but they're the right primitive for "disable a noisy contrib node" tooling.

**The `:module` and `:set` params are regex-routed** so they handle scoped npm names like `@flowfuse/node-red-foo` correctly. The matched path includes the leading `@scope/` portion in `req.params[0]`. Other routers that strip slashes break this — relevant if you put a reverse proxy in front of Node-RED.

---

### 2.8 GET `/settings`

**Public-safe runtime settings**, NOT the contents of `settings.js`. Documented keys per the source `runtime/lib/api/settings.js#runtimeSettings`:

```
{ httpNodeRoot, version, context: {...}, codeEditor: {...},
  markdownEditor: {...}, libraries:[...], theme:{...}, palette: {...},
  flowFilePretty, flowEncryptionType, diagnostics:{enabled, ui},
  runtimeState:{enabled, ui}, externalModules:{...}, multiplayer:{...},
  user:{username, permissions, anonymous?, image?},
  // optional, only present in some configs:
  tlsConfigDisableLocalFiles, httpStaticRoot, projects:{...} }
```

Response shape **changes silently between versions** — new keys appear without ceremony. Some that FlowOtter should be defensive about:

- `multiplayer` was added in 4.0 (collaborative editor).
- `diagnostics` and `runtimeState` are 3.0+.
- `user` only appears when adminAuth is configured.

FlowOtter today treats this as `Record<string, unknown>` which is fine; consider extracting `.version` to confirm the connected Node-RED version (used to gate features).

---

### 2.9 GET `/context/...` and DELETE `/context/...`

**Source:** `editor-api/lib/admin/context.js`. Introduced in **0.19**.

**Path patterns:**

- `/context/global` — all global keys (one store).
- `/context/global/keyName` — single key (supports dotted nested paths via the path tail).
- `/context/flow/<flowId>` — all flow-context keys.
- `/context/flow/<flowId>/keyName` — single flow key.
- `/context/node/<nodeId>` — all node-context keys.
- `/context/node/<nodeId>/keyName` — single node key.

**Query params:**

- `?store=<name>` — pick a specific context store when `contextStorage` defines multiple (e.g. file vs memory).
- `?keysOnly` — return only key names, not values (useful when values are large).

**DELETE quirks:** the `delete` route for the **whole scope** (e.g. wipe all of `global`) is **commented out** in source. You can only delete individual keys. FlowOtter should not promise "wipe global context" as a tool — it isn't supported.

Permission split: `context.read` vs `context.write` are **distinct from `flows.*`** — granular permission tokens issued under `scope: "*"` get both, but a `read`-scope token won't write context.

---

### 2.10 `/plugins` endpoints (2.1 / 3.1 / 4.1)

**Three routes mounted unconditionally in 2.1+:**

- GET `/plugins` (content-negotiated like `/nodes`).
- GET `/plugins/messages` (i18n).

**Two routes added in 3.1** (palette manager plugin support, commit 81937dd 2023-10-17):

- GET `/plugins/:module` — module info.
- GET `/plugins/:module/:set` — single plugin config.

**4.1 maintenance refactor** (commit b93582f 2025-09-30, `Splits the logic into two routes`) split a previously-overloaded single handler into clean per-route handlers. **Behavior is the same** for callers — the response shapes did not change — but pre-4.1.x versions had a bug where `:module` and `:module/:set` could collide when a plugin's set name shadowed a module name. Any FlowOtter integration test against pre-4.1.2 should expect this collision.

FlowOtter does not currently use any `/plugins/...` endpoint. For an agent that wants to "enumerate installed editor plugins" (theme, palette extensions, etc.) this is the only path.

---

## 3. Error response convention

**Source:** `editor-api/lib/util.js#rejectHandler`. Public summary at `/docs/api/admin/errors`.

All non-204 errors return JSON `{code: <string>, message: <string>}`. Documented codes:

| code                    | typical status | meaning                                                                |
| ----------------------- | -------------- | ---------------------------------------------------------------------- |
| `unexpected_error`      | 500            | Catch-all.                                                             |
| `invalid_request`       | 400            | Malformed request body / params.                                       |
| `invalid_api_version`   | 400            | `Node-RED-API-Version` not in `{v1, v2}`.                              |
| `version_mismatch`      | 409            | v2 POST `/flows` rev mismatch.                                         |
| `not_authorized`        | 401            | Missing/invalid Bearer.                                                |
| `settings_unavailable`  | 400            | Storage layer can't write settings.                                    |
| `module_already_loaded` | 400            | POST `/nodes` for an installed module.                                 |
| `type_in_use`           | 400            | Disable/remove of a module whose nodes are live.                       |
| `diagnostics.disabled`  | 403            | GET `/diagnostics` when feature disabled (source-only — undocumented). |

**No documented stability guarantee** on these strings — they can change between minor versions. FlowOtter should not pattern-match `code` strings beyond the four it actually needs (`version_mismatch`, `not_authorized`, `invalid_api_version`, `diagnostics.disabled`).

---

## 4. Per-version feature timeline

| Node-RED       | Released                | API-relevant addition                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.15.0         | 2016-10-12              | `Node-RED-API-Version: v2` introduced for `/flows` (rev/flows envelope).                                                                                                                                                                                                                                                                                                   |
| 0.19.0         | 2018-08-14              | Single-flow CRUD (`/flow`, `/flow/:id`); `/context/...` admin routes.                                                                                                                                                                                                                                                                                                      |
| 0.20.0         | 2019-03-12              | i18n catalog refactor (`/nodes/messages`, `/nodes/:module/:set/messages`).                                                                                                                                                                                                                                                                                                 |
| 1.0.0          | 2019-09-30              | No new admin endpoints — runtime/editor reorg only.                                                                                                                                                                                                                                                                                                                        |
| 2.0.0          | 2021-07-20              | Plugin runtime infrastructure laid.                                                                                                                                                                                                                                                                                                                                        |
| 2.1.0          | 2020-12-23 _(see note)_ | `/plugins`, `/plugins/messages` shipped. _(Note: `2.1.0` historically lands in **late 2021**; `git log` puts the plugin commit a006b52 at 2020-12-10 which means it shipped in **2.0** or **2.1** depending on cherry-picks. Exact tag — flag as **inferred** from commit-vs-tag dates; if a FlowOtter integration target needs `/plugins`, gate on `>= 2.1` to be safe.)_ |
| 3.0.0          | 2022-07-14              | `/diagnostics`, `/flows/state` (GET + POST).                                                                                                                                                                                                                                                                                                                               |
| 3.1.0          | 2023-09-06              | `/plugins/:module`, `/plugins/:module/:set` (palette manager plugin support).                                                                                                                                                                                                                                                                                              |
| 4.0.0          | 2024-06-20              | **No new admin endpoints.** Min Node.js 18. `httpAdminCookieOptions`, `httpStaticCors` are settings additions only.                                                                                                                                                                                                                                                        |
| 4.1.0          | 2025-07-29              | **No new admin endpoints.** Editor UX work.                                                                                                                                                                                                                                                                                                                                |
| 4.1.2 → 4.1.10 | 2025-12 → 2026-05       | Maintenance: `/plugins` route split (4.1.2/3 era), `/nodes` tgz validation tighten (4.1.10), bundled `npm` for cross-platform module install (4.1.9). No surface changes.                                                                                                                                                                                                  |
| 5.0.0-beta.6   | 2026-04-30              | **No new admin endpoints.** OAuth strategy callback redesigned (PR #5657, exchange-code pattern). Min Node.js 22.9.                                                                                                                                                                                                                                                        |

**Bottom line:** the admin REST surface has been remarkably stable. Everything material was in place by **3.1**. Anything 3.1+ shares the same endpoint shape; anything 4.x+ shares it byte-for-byte.

---

## 5. What FlowOtter currently misses

FlowOtter's `src/adapters/nodered/client.ts` calls **6** of the 34 endpoints above:

| In use | Endpoint           | Method on `NodeRedClient` |
| ------ | ------------------ | ------------------------- |
| yes    | GET `/flows`       | `getFlows`                |
| yes    | POST `/flows`      | `postFlows`               |
| yes    | GET `/flows/state` | `getFlowsState`           |
| yes    | GET `/settings`    | `getSettings`             |
| yes    | GET `/diagnostics` | `getDiagnostics`          |
| yes    | GET `/nodes`       | `getNodeTypes`            |

**28 endpoints unused.** The ones that are clearly relevant to FlowOtter's mission (typed authoring + safe deploy) and that I'd recommend adding, ranked by value:

1. **GET `/flow/:id`** — read **one** flow tab without dragging the entire `flows.json`. Big win for incremental authoring; FlowOtter could fetch only the tab it's about to edit, avoiding revision contention with another editor.
2. **POST `/flow`** — add a new flow tab in isolation. Lets an authoring spec land a new tab without rewriting the full document. Note the runtime overwrites the supplied `id`; FlowOtter must capture and remap.
3. **PUT `/flow/:id`** — update one tab. Same incremental win as #1; pairs with #1 for read-modify-write of a single tab. Avoids full-deploy risk.
4. **DELETE `/flow/:id`** — symmetric with #2; lets the snapshot/restore path drop a tab cleanly.
5. **GET `/flow/global`** — read the global config nodes + subflow definitions as a unit. FlowOtter currently has no way to introspect global config nodes without parsing `/flows` output — this is the dedicated route.
6. **POST `/flows/state`** with body `{"state":"stop"}` — soft-stop the runtime before deploy, then restart. Useful as a safety primitive for risky deploys (gates on `settings.runtimeState.enabled === true`, so FlowOtter must probe `/settings` first).
7. **PUT `/nodes/:module`** with `{enabled:false}` — disable a misbehaving contrib module without uninstalling. Relevant for an `agent` tool that wants to quarantine a node type that keeps erroring.
8. **GET `/context/global`**, `/context/global/<key>`, with `?keysOnly` — read state without firing the flow. Lets FlowOtter introspect what nodes have stashed in context, which is otherwise opaque to a static `flows.json` view.
9. **GET `/plugins`** — enumerate editor plugins. Low priority but sometimes relevant (theme plugins can override deploy button behavior).

**Specific behavior gaps in the current client** even on the 6 endpoints it does call:

- **POST `/flows` 409 body shape.** Source uses the runtime's `version_mismatch` error which carries `{code, message, ...}`, NOT a top-level `rev`. FlowOtter's `postFlows` reads `parsed.rev` and may always get `undefined`. The actual rev (when present) is on `parsed.rev` only when the runtime's `flows.setFlows` rejection includes it — which it does in 3.0+ but the doc is ambiguous. **Recommend** widening the parser to accept both shapes.
- **GET `/diagnostics` 403 path.** When `diagnostics.enabled: false`, response is 403 with `{code:"diagnostics.disabled"}`. `getDiagnostics()` currently surfaces this as a generic `NodeRedHttpError`. **Recommend** checking for the 403/code combo and surfacing a specific "diagnostics disabled at this Node-RED" error, since enabling it is a settings change the operator must make.
- **GET `/flows/state` always-200.** As of 3.0+, even when `runtimeState` is disabled, GET returns `{state:"start"}`. FlowOtter can rely on this, but the docs are misleading.
- **`Node-RED-API-Version` on POST `/flows`.** FlowOtter currently always sends `v2`. Older Node-RED (< 0.15) would 400 — but those are out of support. Safe today.
- **`/nodes` content negotiation.** FlowOtter correctly sends `Accept: application/json`. If that header is ever omitted, the response is HTML, not JSON, and `getNodeTypes` will silently return broken data. **Recommend** asserting JSON content-type on the response.

**Things FlowOtter probably does NOT need:**

- POST `/nodes` (palette install) — outside MCP authoring scope; security risk.
- `/auth/strategy/...` — only if FlowOtter ever needs to drive a SAML-secured Node-RED, which is unusual.
- `/plugins/messages`, `/nodes/messages` — i18n catalogs, not relevant for a programmatic client.

---

## Sources

- Node-RED admin API methods index: <https://nodered.org/docs/api/admin/methods/> (undated; covers 4.x docs)
- OAuth flow doc: <https://nodered.org/docs/api/admin/oauth> + raw source <https://github.com/node-red/node-red.github.io/blob/master/docs/api/admin/oauth.md>
- Errors doc: <https://nodered.org/docs/api/admin/errors> (undated)
- Per-method docs: `/docs/api/admin/methods/<verb>/<noun>/`
- Source-of-truth route table: `node-red/node-red @ packages/node_modules/@node-red/editor-api/lib/admin/index.js`
- Per-handler source: `editor-api/lib/admin/{flows,flow,nodes,context,plugins,diagnostics,settings}.js`
- Auth source: `editor-api/lib/auth/{index,tokens}.js`
- Release blogs: 3.0 <https://nodered.org/blog/2022/07/14/version-3-0-released>, 3.1 <https://nodered.org/blog/2023/09/06/version-3-1-released>, 4.0 <https://nodered.org/blog/2024/06/20/version-4-0-released>, 4.1 <https://nodered.org/blog/2025/07/29/version-4-1-released>
- 5.0 roadmap: <https://nodered.org/blog/2025/12/03/node-red-roadmap-to-5>
- Releases (tag dates): `gh api repos/node-red/node-red/releases`
- CHANGELOG: <https://github.com/node-red/node-red/blob/master/CHANGELOG.md>
- Discourse forum quirks (token TTL, 409 mismatch, runtimeState gating): <https://discourse.nodered.org/>
