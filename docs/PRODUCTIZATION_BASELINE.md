# Productization Baseline

TomorrowEdge 1.0.0 focuses on the minimum product surface needed for users to
run a real repository safely, understand what happened, and recover. Capability
maturity is tracked in [Capability Status](CAPABILITY_STATUS.md).

## Implemented By 1.0.0

- First-run config options for access mode, routing mode, default test command,
  provider/model selection, and cloud repo-context policy.
- More actionable `tedge doctor` diagnostics with JSON output, provider status,
  fix hints, URL validation, placeholder detection, and price visibility.
- Full/partial shell execution hardening:
  - shell metacharacters are blocked
  - dangerous executables are blocked
  - commands are executed without `shell: true`
  - verification command allowlist is enforced
- Crypto-backed IDs via `crypto.randomUUID()`.
- Expanded secret detection and redaction for event payloads and artifact
  content.
- Task-relevant context selection using goal/plan keywords, path/content
  matches, source/test metadata, and expected file hints.
- Patch application rollback when a later file write fails.
- Anthropic/Gemini now use native REST adapters; OpenRouter remains the easiest
  multi-family onboarding route.
- Package metadata, `typecheck`, CLI smoke, and CI coverage for productized
  release checks.

## Still Explicitly Not Done

- Live TUI event streaming. The architecture note exists, but the current TUI is
  still primarily post-run.
- Full live smoke matrix for native Anthropic and Gemini with real API keys.
- Full provider smoke matrix with real API keys.
- Team policy, plugin API, strategy memory, and metrics dashboard.
- Complete i18n.

These remain roadmap items rather than hidden claims.

## Product Rule

Do not trade visibility for framework integration or automation speed. The
cockpit must continue to own authorization, traceability, redaction, replay, and
recovery.
