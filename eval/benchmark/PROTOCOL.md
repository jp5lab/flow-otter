# S6 Benchmark Protocol

Status: pre-registered by EVAL-3 before the first scored S6 run.

Frozen threshold hash:

- `eval/benchmark/thresholds.json` sha256: `e61d7bb58d94ccebf7915a6e6f0cdaff49ec8272d25183ab20070231458d2380`

## Corpus

The charter corpus is exactly the two sterile 2026-06-10 audit fixtures in
`tests/fixtures/audit-2026-06-10/`, pinned by that directory's SHA-256 manifest
and repeated in `eval/benchmark/manifest.json`.

Community flows are fetch-by-manifest only. The manifest schema supports remote
entries with `{url, sha256, license}`, but EVAL-3 intentionally records no real
community entries because community-corpus licensing remains an open question.

Every corpus entry must define at least one operator-semantics criterion. The
criteria are judged separately from aesthetics: a layout that looks better but
breaks the operator's wiring semantics fails the entry.

## Legs

Leg A is the stripped-position leg: the runner removes layout placement from the
source flow, asks the layout path to restore placement, and compares the result
against the source semantics and frozen lint thresholds.

Leg B is the zero-coordinate annotated-spec leg: the runner starts from an
annotated spec with no non-junction node placement. LAYO-2 owns the actual spec
content; until then `eval/benchmark/specs/` contains only a placeholder and the
position-key assertion still runs.

Zero-coordinate disqualification rule: any Leg-B spec that supplies a placement
key on a non-junction node is disqualified before scoring. Junctions are exempt
for `x`/`y` because they are pure wiring waypoints and their coordinates encode
wiring semantics, not layout preference. Junctions are not exempt from a generic
`position` object.

## Blinding And Judges

S6 uses a seeded A/B packet assignment. Judges see paired, blinded render packets
and operator-semantics criteria; the answer key stays outside the judging packet.

The ratified judging panel is two judges: the maintainer and a fresh
no-context agent session. A third judge is used only as a tie-break.

## D-7 R4 Separation Values

These values are pre-registered here and mirrored in `thresholds.json`; D-7 reads
them from the frozen threshold file rather than inventing local constants.

- Score ordering margin: `0.15`.
- `spag-raw`: `layout-backward-wires` offender count is `8`; `layout-wire-crossings`
  offender count is at least `1`.
- Engine-output diagnostics: `layout-group-overlap` offender count is at least
  `2`; comment-pile count is `6`; off-canvas group count is `2`; lane inversion
  fires through `layout-error-lane-below`.
- `e1-agent`: occlusion offender count is at most `3` and no worse than warning;
  F11 true positives are expected.

## Freeze Enforcement

`PROTOCOL.md` records the threshold file hash above. `PROTOCOL.md` cannot record
its own hash without changing the content being hashed, so its final SHA-256 is
recorded only in `docs/DESIGN.md` alongside the threshold hash.

EVAL-4 must verify both recorded hashes before any `--scored` run. If either
hash differs, EVAL-4 refuses scored mode and reports the expected and actual
hashes; supersession requires an explicit design-ratification update.
