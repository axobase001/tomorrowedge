# Roadmap

Authoritative roadmap for TomorrowEdge 1.6.5 Canopus and the post-1.6 line.
This document describes current product direction, not historical 0.x release
planning.

## 1.6.x Canopus Convergence Hardening

Current focus:

- Keep `tedge canopus` and the `tedge control` compatibility alias aligned.
- Make Objective Contract, AcceptanceMatrix, ConvergencePolicy, and RunState
  behavior visible in CLI output, reports, and persisted artifacts.
- Preserve the rule that AgentBridge workers can propose or perform work, but
  blocking acceptance checks decide convergence.
- Keep `mock`, `noop`, `shell`, and `sirius-council` adapters covered by
  deterministic tests.
- Strengthen failure reporting for budget exhaustion, adapter failure,
  acceptance-check failure, and incomplete execution.

Acceptance criteria:

- Canopus examples validate and run without provider credentials.
- `npm run test:control`, `npm run build`, and `npm run docs:status` stay low
  cost and release-gate friendly.
- Reports distinguish action success, convergence success, blocked checks, and
  incomplete runs.

## Sirius Council Clarity

Sirius remains the experimental council-governance runtime inside the current
product line.

Current focus:

- Make delegated execution mode explicit in trace, final summary, and docs.
- Distinguish native governance evidence from command-backed execution
  artifacts.
- Keep Chief selection, Council moves, TaskGraph ownership, delegated task
  results, bounded Strategy Mutation, and Chief final review visible in the
  cockpit and CLI.
- Maintain the packaged mock config path as a reproducible no-key demo.

Acceptance criteria:

- Fixture/native Sirius runs do not imply real patch or shell execution unless
  command, MCP, or Canopus shell artifacts exist.
- `npm run test:council` verifies execution-mode trace fields and packaged mock
  config behavior.
- README, capability status, and council docs use the same semantics.

## Provider And Routing Reliability

Current focus:

- Keep provider diagnostics actionable without requiring live credentials.
- Preserve static fallback catalogs while making stale/live catalog status clear.
- Improve OpenAI-compatible, DeepSeek, Kimi, MiMo, OpenRouter, Ollama,
  Anthropic, Gemini, and custom relay setup paths.
- Expand model compatibility checks where provider-specific model ids drift.

Acceptance criteria:

- Provider setup errors identify the provider, model, API format, auth header,
  and suggested fix.
- Model catalog refresh is provider-scoped and does not leak options across
  role assignments.
- CLI and GUI provider readiness use the same normalized provider semantics.

## Local Cockpit Usability

Current focus:

- Keep React Cockpit as the primary GUI and the local HTML fallback as a
  compatible constrained client.
- Improve task/session visibility, cancellation, run-mode preflight, key setup,
  role assignment, and trace inspection.
- Keep English as the default browser language while preserving Chinese UI
  coverage.
- Treat GUI design tokens and fallback token parity as CI-checked surfaces.

Acceptance criteria:

- Multi-run workflows keep prior sessions visible and recoverable.
- Full-autonomy runs require visible preflight confirmation.
- Stop/cancel controls persist canceled runs as aborted sessions.
- `npm run test:ui`, `npm run web:build`, and `npm run e2e:cockpit` cover the
  main GUI contract.

## Release Hygiene

Current focus:

- Keep README, CHANGELOG, ROADMAP, capability status, and promise-map language
  aligned with the package version.
- Keep package smoke, pack dry-run, docs status, secret scan, and audit checks
  suitable for every release candidate.
- Prefer small contract tests for documented commands and public examples.

Acceptance criteria:

- `npm run docs:status` catches stale version or stale phase wording in ROADMAP.
- Public docs do not document commands that the CLI parser rejects.
- `npm run verify` remains the broad local release gate.
