# FlowOtter <-> Node-RED Admin API correctness audit

**Date:** 2026-05-08  
**Auditor:** code-first reviewer (complementary to the five docs-first agents)  
**Scope:** every line of FlowOtter that talks to Node-RED's Admin API (HTTP) or to its OAuth `/auth/token` endpoint.  
**Reference cut of Node-RED:** `master` branch as of 2026-05-08 (latest is 4.1.x line). Findings note the specific version range affected.  
**Method:** read every Node-RED-touching source file in FlowOtter; cross-check each call against Node-RED's published Admin-API docs at <https://nodered.org/docs/api/admin/methods/> AND the runtime/editor-api source at <https://github.com/node-red/node-red>. Where docs disagree with source, source wins (and the gap is filed as INFO).

> Citations of the Node-RED source point at `master` HEAD as fetched. The four files I quoted heavily are:
>
> - `packages/node_modules/@node-red/editor-api/lib/index.js` (body parsing, route mount)
> - `packages/node_modules/@node-red/editor-api/lib/admin/index.js` (admin route registration)
> - `packages/node_modules/@node-red/editor-api/lib/admin/flows.js` (flows route handlers)
> - `packages/node_modules/@node-red/runtime/lib/api/flows.js` (the runtime API behind /flows)
> - `packages/node_modules/@node-red/editor-api/lib/util.js` (`rejectHandler`, the JSON shape of every error response)
> - `packages/node_modules/@node-red/editor-api/lib/auth/{index,strategies,tokens}.js` (OAuth flow)
> - `packages/node_modules/@node-red/editor-api/lib/admin/{nodes,diagnostics}.js`

---

## Findings, grouped by file

### `src/adapters/nodered/client.ts`

#### F-001 — BLOCKER — Wrong v2 request body shape on POST /flows

- **File:** `client.ts:62-75` (`postFlows`)
- **What we do today:** We send `JSON.stringify({ flows, ...(rev ? {rev} : {}) })` AND set `Node-RED-API-Version: v2`.
- **What the docs say:** With `Node-RED-API-Version: v2` the body is the WHOLE object; the editor-api takes `req.body` and passes it straight through (`opts.flows = req.body`) and the runtime reads `flows.rev`, `flows.flows`, `flows.credentials`. So the wire shape we send is correct _only_ because we happen to mirror the runtime shape — but it's also missing `credentials` (no impact unless we ever push credentials, but worth knowing). The docs explicitly call out `{rev, flows, credentials}` for v2: <https://nodered.org/docs/api/admin/methods/post/flows/>.
  - Source: `packages/node_modules/@node-red/editor-api/lib/admin/flows.js` lines 56-61 (`if (version === "v1") { opts.flows = {flows: req.body} } else { opts.flows = req.body; }`).
  - Source: `packages/node_modules/@node-red/runtime/lib/api/flows.js` `setFlows` reads `flows.rev`, `flows.flows`, `flows.credentials`.
- **Recommendation:** No code change to the body shape — it's valid. **But** (a) downgrade this to INFO if you don't ever push credentials, and (b) consider supporting credentials passthrough for completeness when we eventually need to set per-node secrets. Severity stays BLOCKER **only** because of F-002 below — see there.
- **Versions affected:** all 3.x, 4.x.

#### F-002 — BLOCKER — Parsing 409 response body for `rev` is dead code; we never know the actual server rev on conflict

- **File:** `client.ts:76-90`
- **What we do today:** On 409 we read the body and try `JSON.parse(text).rev` to surface the server's actual rev to the caller via `RevMismatchError`.
  ```ts
  const parsed = JSON.parse(text) as { rev?: string };
  if (typeof parsed.rev === 'string') actualRev = parsed.rev;
  ```
- **What the source says:** Node-RED's 409 body is **always** `{code: "version_mismatch", message: ""}` (or whatever message the runtime set, which is empty in this code path). There is no `rev` field. The handler is `apiUtils.rejectHandler` in `packages/node_modules/@node-red/editor-api/lib/util.js` and it sets `res.status(err.status||400).json({code: err.code||"unexpected_error", message: err.message||err.toString()})` — only `code`, `message`, and optionally `remote`. The rev is in the runtime state, not the response.
  - Source `lib/util.js` `rejectHandler` (definitive): `res.status(err.status||400).json(response)` where `response = {code: ..., message: ...}`.
- **Recommendation:** Remove the `parsed.rev` extraction. Read `parsed.code` (expect `"version_mismatch"`) and `parsed.message` for diagnostic context, but do NOT promise a rev to the caller. To recover the server's actual rev, the caller must do a fresh `GET /flows` after catching the conflict. The unit test at `tests/unit/adapters/nodered/client.test.ts:74-88` mocks `{rev: 'actual'}` on the 409 response — that mock is unrealistic and should be updated to `{code: "version_mismatch", message: ""}`. The error class should also surface the `code` field so callers can distinguish version_mismatch from other 409s (none today, but future-proof).
- **Versions affected:** all 3.x, 4.x. The conflict path in `setFlows` has been stable since v1 of the v2 API.

#### F-003 — HIGH — `Node-RED-API-Version` not sent on POST /flows; we pass `v2` but should also default reads consistently

- **File:** `client.ts:70-75`
- **What we do today:** POST sends `Node-RED-API-Version: v2`. Good. GET also sends `v2`. Good.
- **What the docs say:** The header defaults to `v1` if omitted. v1 returns 204 with no body on POST and an array on GET; v2 returns 200 + `{rev}` body on POST and `{rev, flows}` on GET. We rely on the v2 response shape for GET. No issue unless someone removes the header.
- **Recommendation:** No change. Document this as a hard requirement in code with a comment so a future contributor doesn't drop the header.
- **Versions affected:** Header introduced in Node-RED 0.15.0 — N/A for our supported range.

#### F-004 — HIGH — `parseFlowsResponse` reads `x-rev`/`rev` headers for v1 fallback, but Node-RED never sends those headers

- **File:** `client.ts:192-209` (`parseFlowsResponse`)
- **What we do today:** When we receive an array (the v1 shape), we fall back to `res.headers.get('x-rev') ?? res.headers.get('rev')`.
- **What the docs/source say:** Node-RED v1 GET /flows returns the array with NO rev — there's nowhere to put the rev in v1, and the editor-api code (`flows.js` get handler) just calls `res.json(result.flows)`. No custom headers are emitted: <https://nodered.org/docs/api/admin/methods/get/flows/>. The `x-rev`/`rev` headers are not part of the Node-RED Admin API contract anywhere I could find in either docs or source.
- **Recommendation:** Drop the `x-rev`/`rev` header lookups. The v1 fallback should just set `rev: null`. Today the path is reached (a) only if we mistakenly send v1 in some new code path, or (b) someone proxies Node-RED through middleware that re-shapes the body. Neither is a real concern but the header lookup gives false security.
- **Versions affected:** all 3.x, 4.x. (Header never existed.)

#### F-005 — HIGH — 401/403 collapsed to `AuthFailedError`, but Node-RED uses 403 for "feature disabled" too

- **File:** `client.ts:160-162`
- **What we do today:** Any 401 or 403 throws `AuthFailedError`.
- **What the source says:**
  - `auth/index.js` line 64 returns `res.status(401).end()` for `permission.fail`. (Always 401, never 403.)
  - `admin/diagnostics.js` returns 403 with `{code:"diagnostics.disabled"}` when the feature is administratively disabled.
  - Custom node-developer code (e.g. project apis) can also return 403 for "not in project mode" cases.
- **Recommendation:** Limit `AuthFailedError` to 401. For 403, throw a separate class (e.g. `ForbiddenError` carrying `code` and `message`) so the caller can distinguish "your token can't do that" from "this feature is disabled." Today, our `get_runtime_state` tool (which calls `getDiagnostics()`) will swallow a 403 from a Node-RED that has `diagnostics.enabled: false` and report it as `AuthFailedError` in `diagnostics_error`, which is misleading at best.
- **Versions affected:** 3.0+ (when /diagnostics was introduced); 4.x.

#### F-006 — HIGH — Auth header set after spreading `headers`, but the case `Authorization` collides only if caller passed `authorization` lowercase

- **File:** `client.ts:145-146`
- **What we do today:** `const finalHeaders = { ...headers }; if (auth !== null) finalHeaders['Authorization'] = auth;`
- **What's at risk:** `getFlows()` passes `Accept` and `Node-RED-API-Version` (PascalCase). `postFlows()` passes `'content-type'` LOWERCASE plus `Node-RED-API-Version` and `Node-RED-Deployment-Type` PascalCase. Mixed casing inside JS objects is fine (HTTP is case-insensitive) but `fetch()` can deduplicate header names case-insensitively and emit them in lowercase. Not a correctness issue in itself; flagging for completeness because OAuth `/auth/token` POST has `'content-type'` lowercase too.
- **Recommendation:** Pick one casing and use it throughout (lowercase is the modern standard since fetch normalizes anyway). No functional impact today.
- **Versions affected:** none — purely stylistic.

#### F-007 — MEDIUM — 5xx retry loop uses `continue` that re-enters the timer setup; stale timer not cleared until `finally` after `return`

- **File:** `client.ts:150-184`
- **What's wrong:** On a 5xx that is retried (line 168 `continue`), we exit the `try` block, hit `finally` (timer cleared), loop back, set up a new timer, fire a new fetch. That's fine in isolation. **But** when the fetch resolves with non-5xx and we `return res` (line 170), the `finally` runs and clears the timer for that request — also fine. The issue is more subtle: if the body of the response is read AFTER `return res` (which happens in callers like `getFlows`), no timeout protection covers the body-streaming. Callers that read body via `res.text()`/`res.json()` are racing the timer that has already been cleared.
- **What the docs say:** Not a Node-RED issue; this is fetch semantics. Callers should pass an `AbortSignal` that lives until they finish reading the body, or the client should pre-read the body before returning.
- **Recommendation:** Read the body inside `request()` and return `{status, headers, body}` from a wrapper, OR keep the existing structure but document the limitation. Today every caller does `await res.text()`/`res.json()` immediately after the call so practical exposure is small (latency between `return` and `await text` is tiny), but on slow links a stalled body stream will hang past `timeoutMs`. Severity MEDIUM because the failure mode is hangs-instead-of-timeout, not data corruption.
- **Versions affected:** N/A — JS issue.

#### F-008 — LOW — Retry on 5xx happens BEFORE the request returns, but connection-level errors retry too via the catch block — both retry counters share `attempt` correctly

- **File:** `client.ts:163-180`
- **What's right:** I checked: the retry of 5xx and the retry of catch errors both increment the same `attempt` and respect the same `total` budget. Good.
- **Recommendation:** No change. Documenting for the record.
- **Versions affected:** N/A.

#### F-009 — LOW — `/diagnostics` and `/flows/state` are conditional — calling them on Node-RED 2.x or with the feature disabled returns 404/403/405 respectively

- **File:** `client.ts:104-111` (`getFlowsState`), `client.ts:121-127` (`getDiagnostics`).
- **What we do today:** Both methods just GET the endpoint and let any non-2xx throw `httpError` (or our 401/403 trap fires first).
- **What the docs say:** `/flows/state` requires `runtimeState.enabled = true` in `settings.js`. `/diagnostics` requires `diagnostics.enabled = true` (default true since 3.0, but admins can turn it off). Neither exists in Node-RED 2.x. <https://nodered.org/docs/api/admin/methods/get/flows/state/> notes the runtimeState gate.
- **Recommendation:** No code change beyond F-005 (which already handles the 403 disambiguation). Document the version dependency in the JSDoc on the methods. The `get_runtime_state` tool already wraps the diagnostics call in try/catch (good).
- **Versions affected:** /flows/state added in 3.1 (June 2022); /diagnostics added in 3.0 (Sep 2022).

#### F-010 — INFO — `getNodeTypes` actually returns "node sets," not "types"; misnamed but correct

- **File:** `client.ts:129-135`
- **What we do today:** `getNodeTypes()` GETs `/nodes` with `Accept: application/json`, returns `unknown`.
- **What the source says:** The endpoint returns an array of "node sets" — each set has `id`, `name`, `types[]`, `enabled`, `module`, `version`, `local`, `user` (cite: `packages/node_modules/@node-red/registry/lib/registry.js` `getNodeList`). A single module can register multiple sets, each of which exposes one or more types. So a single `inject` "type" comes from one set, but a contrib package may have many sets each with their own types.
- **Recommendation:** Rename to `getNodeSets` or `listInstalledNodeSets`. Tool name `list_installed_node_types` should also reflect the correct shape (though the current description is operator-friendly). Output zod schema already lets `modules` be `unknown` so no breakage. Severity INFO.
- **Versions affected:** all 3.x, 4.x.

#### F-011 — INFO — `Accept: application/json` exact-match is required; comma-separated lists won't work

- **File:** `client.ts:130-132`
- **What the source says:** `admin/nodes.js` uses `if (req.get("accept") == "application/json")` (strict equality). If you ever change this to `application/json, text/plain` it will silently fall through to the HTML branch.
- **Recommendation:** No change today. Document the constraint. Add a regression test that asserts the JSON branch is taken.
- **Versions affected:** all.

---

### `src/adapters/nodered/auth.ts`

#### F-012 — MEDIUM — Source-vs-docs gap: docs say JSON, server accepts both; we send form-urlencoded which is RFC 6749-correct

- **File:** `auth.ts:56-72` (`fetchToken`)
- **What we do today:** POST `/auth/token` with `content-type: application/x-www-form-urlencoded` and a `URLSearchParams` body — this is what RFC 6749 §4.3.2 specifies for the resource owner password credentials grant.
- **What the docs say:** The published docs state Content-Type `application/json`: <https://nodered.org/docs/api/admin/methods/post/auth/token/>.
- **What the source says:** The editor-api applies BOTH `bodyParser.json()` AND `bodyParser.urlencoded({extended:true})` globally (`packages/node_modules/@node-red/editor-api/lib/index.js` lines 78-79: `adminApp.use(bodyParser.json({...})); adminApp.use(bodyParser.urlencoded({...}));`). So either Content-Type works.
- **Recommendation:** No code change — FlowOtter's behavior is correct and matches the OAuth standard. **File a docs-vs-source gap with Node-RED** so they update the published docs to mention either form-urlencoded OR JSON works (form-urlencoded is the standard).
- **Versions affected:** all 3.x, 4.x.

#### F-013 — HIGH — `expires_in` fallback of 3600s drastically underestimates real lifetime; if the response somehow lacked the field, we'd refresh the token 7-x more often than needed

- **File:** `auth.ts:83`
- **What we do today:** `const expiresInMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;` — fallback is 1 hour.
- **What the source says:** Node-RED ALWAYS sets `expires_in` from `sessionExpiryTime` which defaults to **604800 seconds (7 days)** (`packages/node_modules/@node-red/editor-api/lib/auth/tokens.js`: `sessionExpiryTime = adminAuthSettings.sessionExpiryTime || 604800` and `return {accessToken, expires_in: sessionExpiryTime}`).
- **Recommendation:** Two options:
  1. Make the fallback align with reality: 604800 seconds. No actual code path hits this branch with a real Node-RED, so it's belt-and-suspenders.
  2. Throw if the response is missing `expires_in` — fail-fast against an unexpected proxy or a future Node-RED that changes the contract.
     Prefer option 2. Severity HIGH because the current 3600s default makes our token cache thrash unnecessarily under any future condition that omits `expires_in`.
- **Versions affected:** all 3.x, 4.x.

#### F-014 — MEDIUM — No refresh-token support; not surfaced as a limitation in code/comments

- **File:** `auth.ts` whole file
- **What we do today:** On expiry, we re-do the password grant.
- **What the docs/source say:** Node-RED's auth backend does not issue refresh tokens (only `access_token` + `expires_in`). The OAuth spec allows omitting refresh tokens for the password grant. The strategies file (`auth/strategies.js` `passwordTokenExchange`) calls `done(null, tokens.accessToken, null, {expires_in: tokens.expires_in})` — the third arg (refresh token slot) is `null`.
- **Recommendation:** Add a JSDoc comment explaining no refresh token is supported and that re-authentication on expiry is by design. No code change. INFO/MEDIUM — operationally fine but worth documenting.
- **Versions affected:** all.

#### F-015 — MEDIUM — Token-revoke endpoint not used; we never hit `/auth/revoke` even on shutdown

- **File:** `auth.ts` (no implementation), `bin/flow-otter.ts` (shutdown logic).
- **What we do today:** When FlowOtter exits, the token sits in Node-RED's session map until its `expires_in` ticks down (default 7 days). Anyone who steals that token from process memory before it expires can use it.
- **What the docs say:** POST `/auth/revoke` with `{token}` body invalidates the token. Quote: `auth/index.js` `revoke()` handler calls `Tokens.revoke(token)`.
- **Recommendation:** Add an optional `revoke()` method on `PasswordGrantAuth` and call it from the shutdown handler in `bin/flow-otter.ts`/`server/transport/shutdown.ts`. Severity MEDIUM — security-defense-in-depth, not a bug.
- **Versions affected:** all 3.x, 4.x.

#### F-016 — LOW — `client_id` defaults to `node-red-admin`; valid choices are exactly `node-red-admin` or `node-red-editor`

- **File:** `auth.ts:64`
- **What we do today:** `client_id: this.opts.clientId ?? 'node-red-admin'`.
- **What the docs/source say:** The `Clients` module (`auth/clients.js`) defines two valid client IDs. Anything else is rejected by the `clientPasswordStrategy` because `Clients.get(clientId)` returns null. Passing `node-red-admin` is correct for an admin-API caller.
- **Recommendation:** No change. Add a comment citing the two valid values. Optional: validate `clientId` against the enum if a caller passes a custom one.
- **Versions affected:** all.

#### F-017 — LOW — `scope` defaults to `*`; the actual full scope from a credentials login is `read,write` (or whatever the user has). `*` is a shorthand the server accepts.

- **File:** `auth.ts:61`
- **What we do today:** `scope: this.opts.scope ?? '*'`.
- **What the source says:** `passwordTokenExchange` checks `permissions.hasPermission(user.permissions, scope)` — if the user has full perms, `*` works. The empty string `""` causes the server to substitute `user.permissions`. So `*` is fine for a user with `*` perms; for narrower users it would fail.
- **Recommendation:** No change for typical cases. Document that the caller can pass narrower scopes (e.g. `'flows.read'`) and that the request will fail if the user can't grant it. INFO.
- **Versions affected:** all.

#### F-018 — INFO — Token-refresh buffer is 30s; tokens with 7-day TTL never come close to refreshing on the buffer

- **File:** `auth.ts:39, 48`
- **What we do today:** `if (this.cached && this.cached.expiresAt - now > TOKEN_REFRESH_BUFFER_MS) return cached;`
- **Note:** With a 7-day token, the 30s buffer means we re-auth roughly never. That's correct. If `sessionExpiryTime` is configured down to a few minutes, the 30s buffer is about right.
- **Recommendation:** No change.
- **Versions affected:** N/A.

---

### `src/adapters/nodered/deploy.ts`

#### F-019 — LOW — `DEPLOY_TYPE_HEADER = 'Node-RED-Deployment-Type'`; correct and case is preserved literally; default is `nodes` — slightly safer than Node-RED's own default of `full`

- **File:** `deploy.ts:1-7`
- **What we do today:** Default deploy mode is `'nodes'`. `'full'`, `'nodes'`, `'flows'`, `'reload'` all correctly enumerated.
- **What the docs say:** Server default is `full` if header omitted. FlowOtter picks `nodes` as a (sensibly) less-disruptive default. Documented at <https://nodered.org/docs/api/admin/methods/post/flows/>.
- **Recommendation:** No change; document the deviation from the server default in the comment near `DEFAULT_DEPLOY_MODE`. INFO.
- **Versions affected:** N/A.

#### F-020 — INFO — `reload` deploy mode skips the rev check on the server side

- **File:** `deploy.ts` (just the constant); used in `client.ts:postFlows`.
- **What the source says:** `runtime/api/flows.js` `setFlows` does `if (deploymentType === 'reload') { apiPromise = runtime.flows.loadFlows(true); }` BEFORE checking rev. That means `reload` mode IGNORES the rev — even if you pass one, no version check occurs.
- **Recommendation:** Document this in the deploy.ts comment. FlowOtter's drift check fires before the call so it's caught earlier, but a contributor reading client.ts alone would assume rev is always honored.
- **Versions affected:** all 3.x, 4.x.

---

### `src/adapters/nodered/errors.ts`

#### F-021 — MEDIUM — `RevMismatchError.actualRev` will always be `undefined` because of F-002

- **File:** `errors.ts:20-29`, used in `client.ts:85-89`.
- **What we do today:** Class promises an `actualRev` field; client.ts sets it from a body field that doesn't exist.
- **Recommendation:** Either remove `actualRev` from the class OR repopulate it by issuing a fresh `GET /flows` inside `postFlows` after catching 409 (round-trip cost: one extra HTTP call). Pair with F-002 fix.
- **Versions affected:** all 3.x, 4.x.

#### F-022 — LOW — `NodeRedHttpError` doesn't expose Node-RED's structured `code` field

- **File:** `errors.ts:38-47`.
- **What we do today:** Stores the raw body string in `body`. Caller that wants the structured `code` (e.g. `"version_mismatch"`, `"diagnostics.disabled"`, `"unexpected_error"`) has to JSON.parse it themselves.
- **Recommendation:** Add an optional `code?: string` and parse it in `httpError()` (`client.ts:211-214`). Helps tools surface a clean error reason in audit logs.
- **Versions affected:** all.

---

### `src/adapters/flowsource/adminapi.ts`

#### F-023 — LOW — `AdminApiFlowSource.fingerprint` performs a full `getFlows` call; for a large flows.json this is O(MB) over the wire just to compute a sha256

- **File:** `adminapi.ts:31-34`.
- **What we do today:** `getFlows()` then `canonicalHash(flows)`.
- **What the docs say:** No lighter endpoint exists. The `rev` field IS the server's truth-fingerprint already; only need `canonicalHash` if we want a hash that's stable across servers (e.g. to compare a snapshot taken on machine A with a runtime on machine B).
- **Recommendation:** Two-tier fingerprint — when caller only needs the rev, return `{sha256: rev, rev}` to avoid the extra hash. When caller needs the canonical hash (drift detection), fall through to the full path. This is a perf optimization, not a correctness bug.
- **Versions affected:** all.

#### F-024 — INFO — `save()` always passes `rev: opts.expectedRev ?? null` and the client converts `null` to "omit rev" — meaning we force-deploy when caller didn't provide a rev

- **File:** `adminapi.ts:24-29` and `client.ts:67-69`.
- **What we do today:** `null` rev means we omit the rev field; Node-RED skips the version check; this is "force deploy."
- **What the source says:** `setFlows` only checks rev if the body has `'rev'` property — a missing rev means proceed unconditionally.
- **Recommendation:** This is correct as long as the calling tool has decided force-deploy is OK (e.g. `deploy_staged_change` sets `expectedRev` only when not forcing). Document this contract on `SaveOptions.expectedRev` so callers don't accidentally omit it.
- **Versions affected:** all.

---

### `src/server/tools/read/get-runtime-state.ts`

#### F-025 — MEDIUM — Description claims state values are "started/stopped/safe-mode" but the API actually returns "start" or "stop" only

- **File:** `get-runtime-state.ts:18`.
- **What we do today:** Tool description: `'Returns the Node-RED runtime state (started/stopped/safe-mode) plus the /diagnostics payload when available...'`.
- **What the source says:** `runtime/api/flows.js` `getState` returns `{state: runtime.flows.state()}` where the value is `"start"` or `"stop"` (verb form, not adjective). There's no `"safe-mode"` from this endpoint — safe-mode info comes from `/settings.safeMode` or `/diagnostics.runtime`.
- **Recommendation:** Update the description to match: "(start/stop)". If you want safe-mode reporting, read `/settings.safeMode` and merge into the output. Severity MEDIUM because callers may write logic on the wrong string values.
- **Versions affected:** 3.1+ (when /flows/state was introduced).

#### F-026 — LOW — Diagnostics request can fail with 403 (`diagnostics.disabled`) and we currently surface that as the generic error string

- **File:** `get-runtime-state.ts:34-37`.
- **What we do today:** Catches and stuffs into `diagnostics_error`.
- **What's wrong:** With F-005 unfixed, the 403 becomes `AuthFailedError: GET /diagnostics: HTTP 403`. Caller can't distinguish "disabled" from "perms" without parsing the message. (Caught and reported, so no propagation, but the message is muddy.)
- **Recommendation:** After F-005 lands, the dedicated `ForbiddenError` will make this self-explaining.
- **Versions affected:** 3.0+.

---

### `src/server/tools/read/list-installed-node-types.ts`

#### F-027 — LOW — Same naming issue as F-010; declares result is "modules" but the endpoint returns node-sets

- **File:** `list-installed-node-types.ts:8-12, 30-32`.
- **What we do today:** `OutputSchema.modules: z.unknown()`.
- **Recommendation:** Rename `modules` to `node_sets` if you want type accuracy; or keep `modules` and document in the description that each entry is a "node set" (a registry-level concept that maps a module to one or more types). Alternatively, since the description says "node modules and node types," use `getModuleList` (`/nodes/:module`) for actual modules. Today's behavior is fine — this is a docs/naming nit.
- **Versions affected:** all.

---

### `src/shared/flows-json.ts`

#### F-028 — MEDIUM — `RegularNodeSchema` doesn't list `d` (disabled), `l` (label-shown), `info` — they pass through `.passthrough()` but type-safety is lost

- **File:** `flows-json.ts:77-91`.
- **What the source says:** Reserved single-character fields per <https://nodered.org/docs/creating-nodes/properties> are `x, y, z, d, g, l`. The runtime uses `node.d` to mark a node disabled (`runtime/lib/flows/util.js` references `node.d`). `node.l` controls label visibility. `info` is the markdown description per node.
- **Recommendation:** Extend `RegularNodeSchema` (and `TabNodeSchema`, `GroupNodeSchema`) with these standard optional fields:
  - regular: `d?: boolean, l?: boolean, info?: string, icon?: string, credentials?: Record<string,unknown>`
  - tab: `locked?: boolean, credentials?: Record<string,unknown>` (locked is on tabs in 3.0+)
  - group: `g?: string` (parent group id when nested), `info?: string`
  - subflow: `meta?: Record<string,unknown>`, `flow?: ...` etc.
    Lots of optional fields — `.passthrough()` keeps them on round-trip but new code that types nodes statically misses them.
- **Versions affected:** `locked` on tabs/subflows is 3.0+; rest are all 3.x, 4.x.

#### F-029 — MEDIUM — `GroupNodeSchema.nodes` requires presence; runtime requires it but newly-authored groups in FlowOtter could omit it accidentally

- **File:** `flows-json.ts:43-56`.
- **What we do today:** `nodes: z.array(z.string())` — required.
- **What the source says:** `runtime/lib/flows/util.js` does `if (n.type === 'group') { ... parentContainer.groups[n.id] = n }`. The `nodes[]` array is referenced when computing diffs (`diffNodes` filter excludes `'nodes'` from group key comparison). Empty array is valid.
- **Recommendation:** Already correct. Documenting that `nodes` MUST be present even if empty. INFO/MEDIUM.
- **Versions affected:** all.

#### F-030 — MEDIUM — `CommentNodeSchema.x` and `.y` required but Node-RED comments can technically exist as non-positioned ghost comments — practically always positioned

- **File:** `flows-json.ts:58-71`.
- **Recommendation:** Keep required. No change. Documenting for completeness.
- **Versions affected:** all.

#### F-031 — LOW — `TabNodeSchema` doesn't require any field beyond `id, type, label`; Node-RED actually accepts a tab with no `label` (defaults to `""`), but FlowOtter's `label: z.string()` rejects missing

- **File:** `flows-json.ts:17-26`.
- **What we do today:** `label: z.string()` — required.
- **What the source says:** When a tab is auto-created (e.g. `clipboard.recoveredNodes`), the editor sets `label`; the runtime tolerates an empty string but doesn't fail validation. `flows.json` files in the wild may have `label: ""`. Minimum tolerance is `z.string().default("")`.
- **Recommendation:** Make `label` optional with default `""` to maximize round-trip safety. Severity LOW — most flows have labeled tabs.
- **Versions affected:** all.

#### F-032 — LOW — `RegularNodeSchema.wires` not required; Node-RED nodes that emit messages MUST have `wires` (even if empty array). Config nodes don't.

- **File:** `flows-json.ts:84`.
- **What we do today:** `wires: z.array(z.array(z.string())).optional()`. The `isRegularNode()` discriminator at line 147-150 uses `'wires' in n` to distinguish regular vs. config nodes.
- **What the source says:** A "regular" node always has `wires` even if it has no outputs (would be `[]`). `isRegularNode` is correct in spirit. The schema lets `wires` be missing — fine for config nodes, but tools that construct regular nodes should always include `wires`.
- **Recommendation:** Use a refinement — if `wires` exists, the node is regular; if not, it's config. Documented; no immediate code change.
- **Versions affected:** all.

---

### `src/server/container.ts`

#### F-033 — LOW — `applyTarget` rebuilds the auth strategy; old `PasswordGrantAuth.cached` token is dropped (good, preventing stale tokens). No revoke is issued (see F-015).

- **File:** `container.ts:218-242`.
- **Recommendation:** Pair with F-015 — when applying a new target, revoke the OLD target's token before discarding. Severity LOW.
- **Versions affected:** all.

---

### `bin/flow-otter.ts`

#### F-034 — INFO — Startup doesn't probe Node-RED reachability; first failure surfaces on the first tool call

- **File:** `bin/flow-otter.ts:18-21`.
- **What we do today:** `startServer()` boots the MCP server without verifying Node-RED is reachable. The `health_check` tool exists for this purpose.
- **Recommendation:** No change required; the existing design (lazy connection) is correct for stdio transports. Keep documenting.
- **Versions affected:** N/A.

---

## Cross-cutting findings

### F-035 — HIGH — No `User-Agent` header sent; some Node-RED proxies/middleware reject anonymous-UA requests

- **File:** `client.ts:145-159`, `auth.ts:67-72`.
- **What we do today:** Default fetch UA (varies by Node version).
- **Recommendation:** Set `User-Agent: flow-otter/${SERVER_INFO.version} (mcp-client)` on every request. Helps in audit-log diagnosis on the Node-RED side, helps WAFs that block unknown UAs, and identifies our requests in `httpAdminMiddleware` hooks the lab might add.
- **Versions affected:** N/A.

### F-036 — MEDIUM — No `gzip`/`deflate` Accept-Encoding; large /flows responses are uncompressed

- **File:** `client.ts:request`.
- **What's at risk:** Large lab flows.json (10k+ nodes) takes seconds to transfer uncompressed.
- **Recommendation:** Set `Accept-Encoding: gzip` (Node 18+ undici fetch handles decompression automatically). Express in Node-RED won't compress unless `compression` middleware is enabled, but if it is (common in production setups), we benefit.
- **Versions affected:** N/A — pure perf.

### F-037 — INFO — No HTTPS-vs-HTTP enforcement at the auth layer

- **File:** `auth.ts:58` and `container.ts:195-197`.
- **What we do today:** `applyTarget` rejects non-http(s) protocols but doesn't refuse to send credentials over plain http.
- **Recommendation:** When `PasswordGrantAuth` is used and `baseUrl.protocol === 'http:'`, log a `WARN` once: "sending credentials over plaintext HTTP." Don't block — the lab uses plain HTTP — but make it visible.
- **Versions affected:** N/A.

### F-038 — LOW — `Connection: keep-alive` not explicitly set; Node 18+ fetch handles this well, but high-frequency tool runs might benefit from explicit pooling

- **File:** `client.ts`.
- **Recommendation:** No change for a stdio MCP server with low call rate. INFO.
- **Versions affected:** N/A.

### F-039 — LOW — No retry-after honoring for 429 responses; Node-RED itself doesn't issue 429, but proxies might

- **File:** `client.ts:160-170`.
- **What we do today:** 429 is not 401/403 and not 5xx — it falls through to `httpError`.
- **Recommendation:** No change unless a future deployment puts a rate-limiter in front of Node-RED. Documenting for the record.
- **Versions affected:** N/A.

### F-040 — INFO — Node-RED exposes `/auth/login` (GET) which returns the auth scheme; we don't probe it before attempting the password grant

- **File:** `auth.ts`.
- **What we'd gain:** A pre-flight `GET /auth/login` would tell us whether the server is anonymous (no `adminAuth`), credentials, or strategy (OAuth2 SSO etc.). We could pick the right auth path automatically.
- **Recommendation:** Optional enhancement. Out of scope for this audit. INFO.
- **Versions affected:** all.

### F-041 — MEDIUM — `getDiagnostics()` is hit via `get_runtime_state` only; no caching, so back-to-back calls re-fetch

- **File:** `client.ts:121-127`, `get-runtime-state.ts:34-35`.
- **What's at risk:** Diagnostics payload includes module versions and OS load — not a high-frequency need. Cached for some seconds would suffice.
- **Recommendation:** Cache for 5-10 s in-memory. Avoid hammering the runtime when AI agent loops. Or, defer to operator policy.
- **Versions affected:** N/A — perf hint.

---

## Executive summary

### Counts by severity

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 2      |
| HIGH      | 6      |
| MEDIUM    | 12     |
| LOW       | 14     |
| INFO      | 7      |
| **Total** | **41** |

### Top 5 most-impactful findings (in priority order)

1. **F-002 BLOCKER — 409 response body has no `rev` field; we extract it anyway.** The current code emits a `RevMismatchError.actualRev = undefined` 100% of the time. Callers that act on `actualRev` are operating on garbage. Fix: stop extracting `rev` from the 409 body; surface the `code` field instead; round-trip `GET /flows` if the caller needs the new rev.
2. **F-005 HIGH — 403 collapsed into `AuthFailedError`.** Node-RED uses 403 for "feature disabled" (e.g. `diagnostics.disabled`), not just for permission failures (which are 401 in Node-RED). Misclassifying these confuses operators trying to debug "is my token wrong?" vs. "is the feature off?".
3. **F-013 HIGH — 1-hour fallback for `expires_in` vs. server's 7-day default.** No hot path today, but if the server ever omits `expires_in` (proxy strips it, future Node-RED change, etc.), FlowOtter enters a thrash loop re-authenticating every hour. Fix: throw on missing `expires_in`, OR fallback to 604800.
4. **F-001 BLOCKER — Body shape lacks `credentials` field.** Today FlowOtter doesn't push credentials, which is why this is operationally low-impact. But the moment a tool wants to set per-node secrets, the lack of credentials in our POST body shape becomes a silent feature gap. Demote to MEDIUM if you're certain credentials will never go through this path.
5. **F-028 MEDIUM — flows.json zod schema missing `d`, `l`, `info`, `locked`, `credentials`, group `g`.** `.passthrough()` keeps round-trip safe, but type-safe code that authors nodes will miss disabled/label-visibility flags. The blast radius is the entire authoring layer.

### Audit completeness check

- Read 100% of `src/adapters/nodered/*.ts` — yes.
- Read 100% of `src/adapters/flowsource/adminapi.ts` — yes.
- Read every tool that calls `noderedClient.*` — yes (only `get-runtime-state.ts`, `list-installed-node-types.ts`, `health-check.ts` go through `noderedClient` directly; everything else goes through `flowSource` indirection).
- Cross-checked every endpoint against:
  - <https://nodered.org/docs/api/admin/methods/> (and its sub-pages for flows, flows/state, diagnostics, nodes, auth/token)
  - `node-red/master` source: `editor-api/lib/{index,admin/index,admin/flows,admin/nodes,admin/diagnostics,auth/index,auth/strategies,auth/tokens,util}.js` and `runtime/lib/api/flows.js`
- Cross-checked unit tests at `tests/unit/adapters/nodered/client.test.ts` against the audit findings — found one stale assumption (F-002 mock) embedded in the tests.

### What's NOT in scope for this audit

- Comms/websocket API (we don't use it).
- Editor/`/red/*` endpoints (we don't use them).
- Storage layer (we don't extend it).
- Project module endpoints (we don't use them).
- Plugin endpoints (we don't use them).
- Context endpoints (we don't use them).
- Subflow-/flow-level endpoints `POST /flow`, `PUT /flow/:id`, `DELETE /flow/:id` (we don't use them — we deploy whole flows.json).
- Dashboard 2.0 specifics (handled by the dashboard-2 agent).
- Feature gaps / new endpoints we should call (handled by the four other research agents).

### Notes on docs-vs-source gaps that should be filed UPSTREAM with Node-RED

- **DOCS-1**: <https://nodered.org/docs/api/admin/methods/post/auth/token/> says Content-Type must be `application/json`; the server accepts both JSON and `application/x-www-form-urlencoded` (RFC 6749 standard). Either is fine, but the docs should mention both.
- **DOCS-2**: <https://nodered.org/docs/api/admin/methods/post/flows/> doesn't document the 409 response body shape (`{code: "version_mismatch", message: ""}`). API consumers writing optimistic-concurrency clients need this.
- **DOCS-3**: <https://nodered.org/docs/api/admin/methods/get/flows/state/> states valid state values are `"start"` and `"stop"` — could be clearer that these are the only two values returned (no `"started"`/`"stopped"`/`"safe-mode"`).
- **DOCS-4**: The single-character reserved-property fields (`d`, `g`, `l`) at <https://nodered.org/docs/creating-nodes/properties> tell users not to use them but never explain what they ARE. `d=disabled, g=parentGroupId, l=labelVisible`.

---

_End of audit._
