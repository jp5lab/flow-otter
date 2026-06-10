# Node-RED Admin API Authentication — Research Reference

**Scope:** what FlowOtter needs to know to talk to the Node-RED Admin API across the versions we are likely to encounter in the wild (1.x → 5.x beta).
**Method:** read primary docs at `nodered.org/docs`, then cross-checked against the actual middleware in `@node-red/editor-api/lib/auth/{index,strategies,tokens,clients,users,permissions}.js` on `node-red/node-red@master`. Version tags are sourced from `gh release view` against `node-red/node-red`.
**Convention:** every claim is tagged with the Node-RED version range it applies to. Where docs and source diverge, the divergence is called out inline.

---

## 1. Auth model overview

Node-RED's admin auth is configured by the `adminAuth` block in `settings.js`. If `adminAuth` is absent, the Admin API is wide open (no header required). The block selects one of two top-level shapes:

- **`type: "credentials"`** — username/password against a local user list, exchanged via OAuth2 password grant for a Bearer token.
- **`type: "strategy"`** — a Passport.js strategy (Twitter, GitHub, generic OAuth/OIDC, SAML in 5.x). The editor redirects through the IdP and a Bearer token is minted at the end.

Either shape may also define:

- `users` — array, function, or external module (≥1.0)
- `default` — anonymous fallback user (≥0.10)
- `tokens` — custom token-validation callback (≥0.20, formalised ≥1.0)
- `tokenHeader` — header name, defaults to `Authorization` (≥0.20)
- `sessionExpiryTime` — token lifetime in seconds, default 604800 = 7 days (introduced 2015-03-30 in commit `7adefd6`, present from 0.10.x onward)
- `module` — settings merged from an external auth module (≥1.0)

The admin app and the editor share one auth surface: the editor logs in by POSTing to `/auth/token` itself. There is no separate "service account" mechanism — the editor is just an OAuth client.

### 1.1 Permission model (≥0.20)

Permissions are resource-based strings of the form `<resource>.<action>`. The `hasPermission(userScope, requestedScope)` function in `permissions.js` matches as follows (verified against `master`, ≥1.0):

1. Empty `requestedScope` → `true`
2. Array of requested scopes → all must match
3. Array of user scopes → any match wins
4. `"*"` user scope → matches anything
5. Exact equality → match
6. User scope `"read"` or `"*.read"` matches any `requestedScope` matching `/^((.+)\.)?read$/`
7. User scope `"write"` or `"*.write"` matches `/^((.+)\.)?write$/`
8. Otherwise → `false`

The Admin API's actual route handlers (`@node-red/editor-api/lib/admin/index.js`, ≥4.0) use these permission strings:

| Resource      | Read                                           | Write                                 |
| ------------- | ---------------------------------------------- | ------------------------------------- |
| `flows`       | GET /flows, /flow/:id, /flows/state            | POST/PUT/DELETE /flow\*, /flows/state |
| `nodes`       | GET /nodes, /nodes/messages, /nodes/:module    | POST/PUT/DELETE /nodes/:module        |
| `context`     | GET /context/global, /context/(node\|flow)/:id | DELETE same paths                     |
| `settings`    | GET /settings                                  | (no admin write)                      |
| `plugins`     | GET /plugins                                   | (none)                                |
| `diagnostics` | GET /diagnostics                               | (none)                                |

Note: `settings.write`, `library.read/write`, `projects.read/write` are referenced in docs but not all routed through `needsPermission()` — projects-mode endpoints have their own checks. Granting `"*"` is the pragmatic default and what the editor itself uses.

### 1.2 Token lifecycle

- `Tokens.create()` (`tokens.js`): generates `crypto.randomBytes(128).toString('base64')` (172-char base64), records `expires = Date.now() + sessionExpiryTime*1000`, persists via `storage.saveSessions(sessions)` (default storage = `~/.node-red/.sessions.json`). 128-byte length ≥1.2 (`Replace Math.random with crypto.getBytes for session tokens`, 2020-09-11, `70b6674`); earlier versions used `Math.random`.
- Tokens are absolute-expiry, **not sliding**. There is no refresh: re-login is the only renewal. Confirmed by knolleary on the forum: _"The whole area of session expiry/refresh is doable, but it does feel like the API could be more helpful."_ (≥1.x, still true in 4.1.10/5.0-beta.6 — no `refresh_token` in the source.)
- `Tokens.revoke(token)` removes from in-memory `sessions` and persists.
- A periodic `expireSessions()` reaper drops expired tokens.
- Storage is the configured runtime storage module — default localfilesystem, but the projects-aware storage (≥0.18) and any user-replaced `storageModule` will all see `saveSessions`.

---

## 2. Password grant flow — request/response detail

### 2.1 Pre-flight: `GET /auth/login`

Tells you which scheme is active. Behaviour confirmed against `editor-api/lib/auth/index.js` (master, applies to ≥0.18 with the modern shape stable since 1.0):

- No `adminAuth` → `200 {}`
- `type: "credentials"` → `200 { "type":"credentials","prompts":[{"id":"username","type":"text","label":"Username"},{"id":"password","type":"password","label":"Password"}] }`
- `type: "strategy"` → `200 { "type":"strategy","prompts":[{"type":"button","label":...,"icon":...,"url":"/auth/strategy"}], "autoLogin": true|false }`

FlowOtter can use this to detect "is there auth?" without sending credentials — useful for `set_target` flow.

### 2.2 `POST /auth/token` (≥0.10, stable since 1.0)

Wired up via `oauth2orize.exchange.password(strategies.passwordTokenExchange)` in `auth/index.js`. Two middleware are layered on:

1. `ensureClientSecret()` — if the request body has no `client_secret`, the middleware injects the literal string `"not_available"`. Source (`auth/index.js`):
   ```js
   if (!req.body['client_secret']) {
     req.body['client_secret'] = 'not_available';
   }
   ```
2. `authenticateClient()` — Passport `client-password` strategy. Looks up the client in `clients.js` array literal (verbatim, applies ≥0.10):
   ```js
   var clients = [
     { id: 'node-red-editor', secret: 'not_available' },
     { id: 'node-red-admin', secret: 'not_available' },
   ];
   ```

So the only `client_id`s the runtime accepts are `node-red-editor` and `node-red-admin`, and the only client-secret it ever validates is the literal `"not_available"`. This is **not configurable** without forking — the "client authentication" layer of OAuth2 is effectively a stub. Anything else → `auth.invalid-client` audit log + 401.

**Request (form-encoded body, `Content-Type: application/x-www-form-urlencoded`):**

```
client_id=node-red-admin
grant_type=password
scope=*
username=admin
password=<plaintext>
```

(`client_secret` is optional; if you send it, it must equal `"not_available"`.)

**Success response (200 JSON):**

```json
{
  "access_token": "<base64, ~172 chars>",
  "expires_in": 604800,
  "token_type": "Bearer"
}
```

`expires_in` always reflects the _configured_ `sessionExpiryTime`. Note: there is **no `refresh_token`** field — neither documented nor in source. FlowOtter's `?: refresh_token` typing is correct only as "we never get one."

**Failure paths (verified in `strategies.passwordTokenExchange`, ≥1.x):**

- Bad `client_id`/`client_secret` → 401, audit `auth.invalid-client`, body usually `{ "error":"invalid_client" }` (oauth2orize default).
- Bad username/password → 403, audit `auth.login.fail.credentials`, body `{ "error":"invalid_grant" }`.
- 5+ failed attempts in a 10-minute rolling window per username → 403, message `"Too many login attempts. Wait 10 minutes and try again"`. The window is in-memory per process; restarting Node-RED resets it. (≥1.x; the rate-limit was tightened in 1.x and remains.)
- Requested `scope` that exceeds user permissions → 403, `auth.invalid-scope`.

### 2.3 `POST /auth/revoke` (≥0.10)

Body: `token=<access_token>`. Header: `Authorization: Bearer <access_token>`. Returns `200 {}` and removes the token from `sessions`. Strategy-based logins may instead get a redirect URL if a logout URL is configured.

### 2.4 Using the token

`Authorization: Bearer <access_token>` on every Admin API request. Bearer is matched first; if it fails, the `tokens()` callback is consulted; if that fails, the `default` user is consulted. (Order verified against `strategies.js` master.)

The editor also accepts `?access_token=<TOKEN>` as a URL parameter for first-load convenience (intended for the `tokens()` callback flow). FlowOtter should not rely on this — header-based is the contract.

---

## 3. OAuth/OIDC strategies — what's stable, what's deprecated

`type: "strategy"` is a thin wrapper around any [Passport.js strategy](http://www.passportjs.org/). Node-RED ships nothing built-in; the user `npm install`s the strategy module and references it from `settings.js`. The wrapper, `genericStrategy()` in `auth/index.js`, registers two routes per strategy:

- `GET /auth/strategy` — initiates the redirect.
- `GET|POST /auth/strategy/callback` — IdP returns here. Method depends on strategy (`callbackMethod: "post"` for SAML).

After the IdP returns, Node-RED still mints a local Bearer token through the same `Tokens.create()` path and redirects to the editor with `#access_token=...` in the fragment.

**5.0.0-beta.6 (2026-04-30)** changed this: PR #5657 _"Use a token exchange pattern for OAuth logins"_ — the redirect now carries a one-shot 20-second exchange code rather than the access token, and the editor exchanges that code for the real token via a second API call. This avoids leaking the access token in the redirect URI / browser history. FlowOtter doesn't go through this flow (it does password grant), so this only matters if we ever support IdP-fronted setups.

### 3.1 Status of named strategies

| Strategy package                                                                 | Node-RED status                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passport-twitter` (the `node-red-auth-twitter` example used in docs since 0.10) | Examples kept verbatim through 4.1, but Twitter's API changes broke shared-app flows; users must register their own app. Functional but not recommended for new deployments. The doc example still uses it as the canonical "strategy" sample. |
| `passport-github` / `passport-github2`                                           | Stable, widely used. Documented in the runtime docs.                                                                                                                                                                                           |
| `passport-oauth2`, `passport-openidconnect`                                      | Stable. Used with Keycloak, Auth0, Azure AD, Okta. No specific Node-RED version gating.                                                                                                                                                        |
| `passport-saml`                                                                  | Works since 1.x. The token-exchange hardening in 5.0-beta.6 was specifically driven by SAML POST callbacks.                                                                                                                                    |
| Custom strategy plugins                                                          | Loadable via `module: require('your-module')` — formalised in 0.20.0 ("Fix use of custom auth strategy plugins") and 1.0; full external `module` shape stable since 1.0.                                                                       |

`autoLogin: true` skips the editor's "Sign in with X" button and immediately redirects to `/auth/strategy`. Node-RED 4.0.0-beta.3 (PR #4684) added a guard against login-loop wedging when `autoLogin` is on and the IdP rejects the user.

### 3.2 The `tokens()` callback (≥0.20, modern shape since 1.1)

Used to validate tokens issued by _somewhere else_ (your IdP, your Vault, an upstream gateway). Signature:

```js
adminAuth: {
  type: "credentials",
  tokens: function(token) {
    return Promise.resolve(/* { username, permissions } | null */);
  },
  tokenHeader: "x-my-custom-token", // optional, defaults to Authorization Bearer
  users: [...],
  default: { permissions: "read" }
}
```

If `tokenHeader` is unset, Bearer parsing applies. If set, the raw header value is passed to `tokens(token)` as-is. Result must be `{ username, permissions }` (permissions string or array) or `null`. Used by reverse-proxy / SSO gateway setups where the proxy injects a header. The custom token does **not** flow through `Tokens.create()`, so `sessionExpiryTime` does not apply — expiry, if any, is the callback's job.

---

## 4. Per-Node-RED-version timeline (auth-relevant only)

| Version    | Date       | Auth-relevant change                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.10       | 2015-02    | OAuth2 `/auth/token` endpoint, password grant, `adminAuth.users`, bcrypt. `sessionExpiryTime` introduced 2015-03-30 (`7adefd6`).                                                                                                                                                                                      |
| 0.19       | 2018-08    | (no auth-specific change; HTTP Request node got Bearer/Digest support — different surface)                                                                                                                                                                                                                            |
| 0.20       | 2019-03    | "Fix use of custom auth strategy plugins" — the `module` extension point becomes reliable. `envVarExcludes` (security-adjacent).                                                                                                                                                                                      |
| 1.0        | 2019-09    | Stable adminAuth shape; `tokens()` and `tokenHeader` formalised.                                                                                                                                                                                                                                                      |
| 1.1        | 2020-06    | `https` may be a function returning a Promise → `httpsRefreshInterval` (hours) lets the runtime swap certs without restart, requires Node 11+. `node-red admin hash-pw` CLI introduced. Websocket comms now authenticate with the user's token.                                                                       |
| 1.2        | 2020-10    | `Replace Math.random with crypto.getBytes for session tokens` — token randomness hardened. `RED.hooks` added (auth-adjacent: lets plugins inject middleware).                                                                                                                                                         |
| 1.3        | 2021-04    | (no major auth change)                                                                                                                                                                                                                                                                                                |
| 2.0        | 2021-07    | Min Node 12. Settings file restructure (auth block layout unchanged).                                                                                                                                                                                                                                                 |
| 2.1–2.2    | 2022-01    | Minor maintenance.                                                                                                                                                                                                                                                                                                    |
| 3.0        | 2022-07    | Min Node 14.                                                                                                                                                                                                                                                                                                          |
| 3.1        | 2023-09    | (no auth change worth noting)                                                                                                                                                                                                                                                                                         |
| 4.0        | 2024-06    | **Min Node 18**. Replace `bcrypt` with `@node-rs/bcrypt` (#4744) — same hashes, native build dropped. `httpAdminCookieOptions` (#4718) added. `httpNodeAuth` accepts middleware arrays (#4572). Login-loop fix when `autoLogin` enabled but IdP rejects (#4684).                                                      |
| 4.0.2      | 2024-07    | "Allow auth cookie name to be customised" (#4815) — `adminAuth.cookieName`.                                                                                                                                                                                                                                           |
| 4.0.3      | 2024-09    | Multiplayer cursor presence (#4845) — security-adjacent: per-user identity surfaced in the editor.                                                                                                                                                                                                                    |
| 4.0.7      | 2024-12    | "Support custom login message and button" (#4993) — cosmetic.                                                                                                                                                                                                                                                         |
| 4.1.0      | 2025-07    | Additional `git_auth_failed` condition (#5145) — Projects mode, not Admin API.                                                                                                                                                                                                                                        |
| 4.1.9      | 2026-05-06 | `crypto.randomUUID` replaces `uuid` lib (#5660) — internal, not the access-token path (still 128-byte randomBytes).                                                                                                                                                                                                   |
| 5.0-beta.6 | 2026-04-30 | **OAuth login uses 20-second one-shot exchange code instead of token-in-redirect** (#5657, SAML). **`Remove default admin cors rules` (#5652)** — the previously permissive default CORS for the admin API is gone; if your client relies on it, you now need explicit `httpAdminCors`. **Min Node.js 22.9** (#5678). |

---

## 5. What `FlowOtter/src/adapters/nodered/auth.ts` probably gets wrong or misses

Reading the file as it stands (98 LoC, three classes + an `authFromEnv`):

### 5.1 What it gets right

- **Bearer header format** — correct (`Authorization: Bearer <token>`).
- **`POST /auth/token` body shape** — correct: `grant_type=password`, `scope=*`, `username`, `password`, `client_id=node-red-admin`, form-encoded.
- **Default scope `*`** — correct; matches what the editor itself uses.
- **Default `client_id` `node-red-admin`** — correct; one of the two literals the runtime accepts.
- **30-second refresh buffer** — defensive, sane.
- **Caching** — correct: store `expires_in` from response, refresh just-in-time.
- **Failure mapping** — `AuthFailedError` for non-2xx, `NodeRedDownError` for network errors. Reasonable.
- **`expires_in` fallback to 3600** — reasonable for malformed servers; in practice Node-RED always sends it.

### 5.2 Gaps and bugs

1. **Missing `client_secret: "not_available"`** — works _today_ because `ensureClientSecret()` injects it server-side, but: (a) any reverse proxy that strips empty fields won't matter since we don't send the field, but (b) third-party shims of Node-RED's auth surface (FlowFuse Cloud, custom auth modules) may _not_ run `ensureClientSecret`, in which case the request fails with `invalid_client`. **Recommendation:** always send `client_secret=not_available` in the body. Cheap insurance.

2. **No `GET /auth/login` probe** — `BearerAuth` and `PasswordGrantAuth` blast straight at protected endpoints. `set_target` could be smarter: probe `/auth/login`, see `{}` → use `NoAuth`; see `{type:"strategy"}` → fail fast with a clear "this Node-RED is behind SSO; use a static `NODE_RED_AUTH_TOKEN`" message; see `{type:"credentials"}` → use `PasswordGrantAuth`.

3. **Rate-limit blindness** — the password grant is rate-limited at 5 attempts / 10 min / username. If FlowOtter is restarted in a tight loop with bad creds, the user will get locked out for 10 minutes with no obvious error mapping. `AuthFailedError` should special-case the `"Too many login attempts"` body and surface it distinctly.

4. **No revocation on shutdown** — `PasswordGrantAuth` mints a token and never calls `POST /auth/revoke`. Tokens accumulate in `~/.node-red/.sessions.json` until they expire (default 7 days). For a long-lived MCP server reconnecting often, this matters. Add an optional `dispose()` that revokes the cached token.

5. **`refresh_token` is dead code** — the `expires_in` field is read but the `refresh_token` field is never read because Node-RED never sends one. Fine to keep the type for future-proofing, but the comment in `auth.ts` should say _"Node-RED does not issue refresh tokens — see research/authentication.md §1.2; we re-run the password grant at expiry."_

6. **No `tokenHeader` support** — if a deployment configures `adminAuth.tokenHeader: "x-my-custom-token"`, FlowOtter's `Authorization: Bearer ...` will be ignored and fall through to `default` (often anonymous-read-only). Add a `headerName?: string` to `BearerAuth` and `PasswordGrantAuth`.

7. **`PasswordGrantAuth` re-fetches on every 401** — actually it doesn't: it only refetches when the cached token is within 30s of expiry. If Node-RED is restarted (which invalidates the in-memory `sessions` if the storage module is non-persistent, or even with persistent storage if `.sessions.json` was wiped), every subsequent request will fail with 401 until the token expires. Fix: on 401, evict the cache and retry once.

8. **No 5.0-beta.6 CORS adjustment** — irrelevant for a server-to-server client, but worth noting in case FlowOtter ever runs in-browser.

9. **`scope` defaulting to `*`** — works but if the caller wants a read-only MCP target, there's no plumbing for `scope: "read"`. The `PasswordGrantOptions.scope` field exists; surface it in `authFromEnv` via e.g. `NODE_RED_SCOPE`.

10. **No bcrypt password hashing helper** — irrelevant for the _client_ (we send plaintext over the wire to `/auth/token`); included here only to flag that FlowOtter intentionally never persists the user's password. Good. Just make sure logging redaction in `client.ts` covers `password=` form-bodies and `Authorization` headers — the audit log may inadvertently capture the request preamble.

11. **No version probe** — `GET /settings` returns `version`. FlowOtter should fingerprint the Node-RED version once per `set_target` and warn (or hard-fail) on versions older than, say, 1.1 where `httpsRefreshInterval`, formal `tokens()`, and the modern audit-log shape stabilise. Versions older than 1.0 (≤0.20.x) lack a stable `module` extension point; the password grant works, but error shapes vary.

### 5.3 What the tests probably don't cover (worth adding)

- A 401 response with body `{"error":"invalid_client"}` from a Node-RED whose `ensureClientSecret` has been replaced.
- A `Too many login attempts` 403 body — we should map it to a distinct error so the operator dashboard can show "wait 10 minutes" rather than "credentials wrong."
- A successful response missing `expires_in` (we fall back to 3600 — verify) or with `expires_in: 0` (we'd refresh on every call — guard against this).
- A token cached just inside the 30-second buffer at the moment of request (off-by-one on the comparison).
- A `tokenHeader`-based deployment where `Authorization` is silently ignored — current code would loop forever fetching a fresh token.

---

## 6. Quick reference: "what to send"

```
POST /auth/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded

client_id=node-red-admin&client_secret=not_available&grant_type=password&scope=*&username=<user>&password=<pw>
```

```
GET /flows HTTP/1.1
Authorization: Bearer <access_token from above>
```

```
POST /auth/revoke HTTP/1.1
Authorization: Bearer <access_token>
Content-Type: application/x-www-form-urlencoded

token=<access_token>
```

That's the entire happy path. Everything else (strategy, IdP, `tokens()`) is opt-in deployment configuration we can detect via `GET /auth/login` and route around.

---

## Sources

- Node-RED docs: <https://nodered.org/docs/user-guide/runtime/securing-node-red>, <https://nodered.org/docs/api/admin/oauth>, <https://nodered.org/docs/api/admin/methods/post/auth/token/>
- Source: `node-red/node-red@master`, files `packages/node_modules/@node-red/editor-api/lib/auth/{index,strategies,tokens,clients,users,permissions}.js` and `lib/admin/index.js`
- Release notes: `gh release view <tag> --repo node-red/node-red` for 0.10, 0.19, 0.20, 1.0, 1.1, 1.1.1, 1.2, 1.3, 2.0, 3.0, 3.1, 4.0, 4.0.2, 4.0.3, 4.0.7, 4.1.0, 4.1.9, 5.0.0-beta.6
- PRs cited: #4684, #4718, #4744, #4815, #4993, #5145, #5652, #5657, #5660, #5678
- Forum: [Expiring tokens](https://discourse.nodered.org/t/expiring-tokens/52050/3) (knolleary's "session expiry/refresh is doable, but the API could be more helpful")
