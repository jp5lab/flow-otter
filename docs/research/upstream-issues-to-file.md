# Upstream issues to file with Node-RED

The audit + research passes turned up four documentation/source gaps in
`node-red/node-red`. Each is a small docs PR or issue. Filed here so we don't
lose track of them; nothing in this list blocks a FlowOtter release.

Repo: https://github.com/node-red/node-red

---

## 1. `POST /auth/token` accepts both `application/json` and `application/x-www-form-urlencoded`

**Where it lives**: https://nodered.org/docs/api/admin/methods/post/auth/token/ —
the docs say the request body is JSON.

**What the source does**: `editor-api/lib/index.js` mounts both
`express.json()` and `express.urlencoded()` body parsers globally, and the
`/auth/token` handler at `editor-api/lib/auth/index.js` reads
`req.body.grant_type` regardless of content type. Form-urlencoded is
RFC 6749-correct (the OAuth password grant standard prescribes
`application/x-www-form-urlencoded`); FlowOtter and many other clients use
form-encoded and have always worked.

**Filing as**: docs PR. Add a sentence: "The endpoint also accepts
`application/x-www-form-urlencoded` as required by RFC 6749 §4.3.2."

---

## 2. 409 response body shape on `POST /flows`

**Where it lives**: https://nodered.org/docs/api/admin/methods/post/flows/ —
the docs say "If the flow data does not match the expected revision, a 409 will
be returned" but don't specify the body shape.

**What the source does**: `runtime/api/flows.js setFlows` returns
`{code: 'version_mismatch', message: ''}` on rev mismatch — no `rev` field.
Multiple downstream clients (including FlowOtter before this audit) parse a
`rev` out of the body, which is always undefined. If callers want the new rev
they must re-issue `GET /flows`.

**Filing as**: docs PR. Add the response body shape to the 409 description.

---

## 3. `GET /flows/state` value enumeration

**Where it lives**: https://nodered.org/docs/api/admin/methods/get/flows-state/

**What the source does**: returns `{state: 'start' | 'stop'}` — present-tense
verbs, not adjectives. Some blog posts and earlier docs imply
`started`/`stopped`/`safe-mode` are valid values; they are not. Safe mode is
orthogonal and lives at `/diagnostics` `runtime.safeMode`.

**Filing as**: docs PR. Document the exact enumeration and clarify that
safeMode is reported separately.

Also: the docs say `runtimeState.enabled: false` blocks the GET; the source
in `editor-api/lib/admin/index.js` only gates POST. GET always returns
`{state: 'start'}` regardless.

---

## 4. Single-character reserved field meanings

**Where it lives**: https://nodered.org/docs/creating-nodes/node-properties/

**What the source does**: nodes carry single-letter fields whose meanings are
documented inconsistently or only implicitly:

- `z`: parent tab/subflow id (mostly documented)
- `g`: parent group id (3.0+; partially documented in the group node page)
- `d`: per-node disabled flag, distinct from tab-level `disabled` (sparsely
  documented; runtime keys `diffNodes` off this)
- `l`: link-label visibility on link-in/link-out (almost undocumented)

**Filing as**: docs PR. Add a one-paragraph table on the node-properties page
listing the reserved single-letter fields and their semantics, so external
authoring tools (n8n's flow tooling, FlowOtter, etc.) can rely on documented
behaviour rather than reverse-engineering from the editor source.

---

## Filing notes

- Open one issue per gap so PRs can be reviewed independently.
- Reference Node-RED runtime master HEAD as of the audit (the version the
  research agents cross-referenced).
- Mention FlowOtter only as "a third-party Admin API client"; the project rename
  - non-public status means linking to our repo doesn't help reviewers.
