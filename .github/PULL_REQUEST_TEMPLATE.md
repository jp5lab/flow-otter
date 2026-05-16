## What this changes

<!-- One or two sentences. What is different in the codebase after this PR. -->

## Why

<!-- The motivation. Link the issue if there is one. -->

## How it was tested

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:unit`
- [ ] `npm run test:property`
- [ ] `npm run test:integration` (requires Docker)

## Risk / blast radius

<!-- What could break? Which tiers (read / author / deploy / dangerous) are affected? -->

## Checklist

- [ ] No secrets in the diff (tokens, real flows with credentials, internal hostnames)
- [ ] No new `Date.now()` / `Math.random()` / `new Date()` inside `src/toolkit/**`
- [ ] Updated `docs/TOOL_REFERENCE.md` if a tool signature changed
- [ ] Updated `CHANGELOG.md` under an unreleased section
- [ ] PR is scoped to one logical change
