# Contributing to FlowOtter

Thanks for considering a contribution. A few things worth knowing up front.

## Project status

FlowOtter v1.3.0 is an active line. Pull requests are welcome — bug fixes, security fixes, documentation, tests, build/packaging, and small ergonomic tweaks to existing tools merge readily. Larger surface-area changes (new tools, new tiers, new validators, layout-engine swaps) should open an issue first so we can talk about the shape.

The hard invariants below MUST hold across any change:

- Byte-identical idempotent compile.
- ID preservation across re-runs.
- Snapshot-before-mutate on every deploy + dangerous operation.
- Drift-refusal on deploy unless explicit `force:true`.
- Substring-level secret redaction at the audit boundary.
- No non-determinism inside `src/toolkit/**`.
- Layer boundary: `src/toolkit/**` must not import from `src/server/**`.

The list of things FlowOtter explicitly chooses _not_ to do (Web UI, multi-language SDKs, cross-environment snapshot promotion, etc.) lives in [`docs/NON_GOALS.md`](docs/NON_GOALS.md).

## Hard rules

The full architectural rules live in `docs/ARCHITECTURE.md`. The lint config enforces:

- **Idempotency.** The same `AuthoringSpec` must compile to byte-identical `flows.json` across runs. Verified by `tests/property/compile-idempotent.test.ts`.
- **ID preservation.** Never regenerate IDs of nodes already present in `prior` flows.
- **No non-determinism inside `src/toolkit/**`.** No `Date.now()`, `Math.random()`, or no-arg `new Date()` (ESLint-enforced).
- **Layer boundary.** `src/toolkit/**` must not import from `src/server/**`.
- **Secrets never appear in agent-visible output.** Redact at the boundary.
- **Snapshot before deploy.** Every deploy creates a restorable snapshot. Drift check refuses on hash mismatch unless explicitly forced.

## Setup

Requires Node.js 20 or later.

```bash
npm install
npm run build
npm run test:unit
```

For integration tests, you'll also need Docker:

```bash
npm run test:integration
```

The integration suite starts Node-RED + Mosquitto via `deploy/docker-compose.yml` (managed by Vitest's `globalSetup`).

## Common commands

```bash
npm run typecheck       # strict TS check, no emit
npm run lint            # ESLint
npm run format          # prettier --write .
npm run format:check    # prettier --check .
npm run test:unit       # ~750 tests, seconds
npm run test:property   # fast-check at numRuns:1000
npm run test:integration  # requires Docker
npm run build           # emits dist/
npm run dev             # tsx bin/flow-otter.ts
```

To reproduce a property-test failure, pin the seed: `VITEST_SEED=<n> npm run test:property`.

## Pull requests

1. Open an issue first for anything beyond a small bug fix or doc change — saves both of us time if the change is out of scope.
2. Keep PRs scoped to one logical change.
3. Run the full local verification before submitting: typecheck + lint + format:check + test:unit + test:property.
4. Update `CHANGELOG.md` under an "Unreleased" section.
5. Don't commit secrets, real flow data with credentials, or internal hostnames in test fixtures.

## Reporting security issues

See `SECURITY.md`. Use GitHub Security Advisories for private disclosure rather than filing a public issue.

## Code style

- TypeScript strict mode. No `any`, no `// @ts-ignore`.
- ESM with NodeNext resolution. Imports include `.js` extensions even for TypeScript files.
- One thing per file in `src/toolkit/validate/rules/**` and `src/server/tools/**`.
- Default to no comments. Annotate only non-obvious WHY.

## License

Contributions are made under the terms of the Mozilla Public License 2.0 (see `LICENSE`). By submitting a PR you agree to license your contribution under MPL-2.0.
