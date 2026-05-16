# Security Policy

## Supported versions

| Version | Supported                              |
| ------- | -------------------------------------- |
| 1.x     | yes — bug & security fixes             |
| < 1.0   | no — pre-release lines, please upgrade |

## Reporting a vulnerability

**Please do not open a public issue for vulnerability reports.**

Use GitHub Security Advisories for private disclosure:

> https://github.com/jp5lab/flow-otter/security/advisories/new

If you cannot use GitHub Security Advisories, you may instead email:

`104044759+jp5lab@users.noreply.github.com`

## What to include

- A clear description of the issue and the security impact.
- Reproduction steps (minimal, no secrets).
- The affected version (output of `flow-otter --version`).
- Any suggested mitigation, if you have one.

## Response timeline

- **Acknowledgment**: within 7 days of receipt.
- **Triage update**: within 14 days.
- **Fix or mitigation**: target within 30 days for medium/high severity; sooner where feasible.

## Disclosure

Coordinated. Public disclosure will be aligned with a patched release. Credit will be given to the reporter unless requested otherwise.

## Threat model

The architectural threat model lives in [`docs/SECURITY.md`](docs/SECURITY.md). It covers tier gates, snapshot/rollback, drift checks, dangerous-operation token scoping, substring-level secret redaction, multi-target state isolation, and the documented accepted risks (e.g., the `/comms` debug buffer surface). Read that document before filing a report — it captures known limits and what is explicitly out of scope.
