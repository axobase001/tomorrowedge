# Contributing to TomorrowEdge

Thanks for helping make TomorrowEdge more usable and auditable.

## Development Setup

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke:cli
npm run secrets:scan
```

TomorrowEdge defaults to offline providers. Do not require live API keys for
unit tests or fixture tests.

## Branches

Use descriptive branch names:

- `feat/<short-topic>`
- `fix/<short-topic>`
- `docs/<short-topic>`
- `test/<short-topic>`

## Pull Requests

Before opening a PR:

- Keep unrelated website or docs-site changes out of core runtime PRs.
- Do not commit `.env`, `.tomorrowedge/`, session traces, API keys, or local
  artifacts.
- Add focused tests for runtime, provider, safety, or CLI contract changes.
- Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run smoke:cli`.
- Run `npm run secrets:scan` before pushing provider/config changes.

## Safety Rules

- Full mode changes must preserve event-ledger visibility.
- Shell execution must stay guarded and must not use `shell: true`.
- Provider errors, stdout, stderr, and artifacts must be redacted before
  persistence/export.
- Placeholder adapters must fail with clear messages instead of pretending to be
  production-ready.
