# Changelog

All notable changes to TomorrowEdge will be documented in this file.

This project follows the common open-source changelog shape inspired by Keep a
Changelog: newest changes first, grouped by release and by change type.

## [Unreleased]

- Track future changes here before cutting the next version.

## [0.1.1] - 2026-06-03

### Added

- Orchestration backend abstraction with `OrchestrationBackend`, `NativeBackend`,
  backend registry, and async event-stream contract.
- `orchestration.backend` config with supported values `native`, `langgraph`,
  `crewai`, and `autogen`.
- Placeholder adapters for LangGraph, CrewAI, AutoGen, and MCP tool bridging with
  clear unavailable-backend errors.
- Backend architecture docs:
  `docs/ORCHESTRATION_BACKENDS.md`, `docs/MCP_ADAPTERS.md`,
  `docs/LANGGRAPH_ADAPTER_PLAN.md`, and `docs/CREWAI_ADAPTER_PLAN.md`.

### Changed

- `tedge run` now executes through the orchestration backend registry while
  preserving the native graph as the default executable backend.
- README now positions TomorrowEdge as a full-access cockpit for native workflows
  and existing agent frameworks, not as another agent framework.

## [0.1.0] - 2026-06-03

### Added

- TUI-first multi-model coding cockpit with Planner, Explorer, Coder, Reviewer,
  Judge, Runner, Repairer, Summarizer, and Vision roles.
- Access modes: `restricted`, `partial`, and `full`, including full-autonomy
  patch, shell, and repair execution with visible event tracing.
- Replayable event ledger with `events.jsonl`, artifact refs, markdown/json
  export, verbose trace output, and artifact-expanded reports.
- Capability stitching route for image/screenshot/diagram input:
  Vision Agent -> Structured Visual Spec -> Planner/Coder -> Reviewer/Runner.
- Configurable provider/model routing for OpenRouter, DeepSeek, MiMo,
  OpenAI-compatible APIs, Kimi-compatible placeholders, Ollama, mock, and
  fixture providers.
- Core-led workflow simulation and non-mutating multi-model drill commands.
- Local memory for compact task metadata and replayable session summaries.

### Changed

- Model ownership is configurable through `.tomorrowedge/config.yaml` instead of
  being hardcoded per role.
- Fixture mode is exposed as `--fixture-mode`; the older `--provider fixture`
  path is deprecated.
- README and docs now describe Node `>=20.19.0`, fixture approvals, config
  safety, preferences, trace/export usage, and recommended model setups.
- `tedge mode` now syncs project preferences so stale access-mode preferences do
  not silently override the selected mode.

### Fixed

- Provider diagnostics and live patch reliability, including provider timeout,
  exact smoke checks, fallback visibility, and normalized patch hunk counts.
- Cross-session context leakage by excluding `.tomorrowedge/**` from explored
  context.
- `tedge init` no longer overwrites an existing config unless `--force` is
  provided.
- `.env` shadowing by existing shell environment variables is surfaced as a
  warning.
- Budget preflight uses default cloud provider price estimates when explicit
  `*_PRICE_PER_MTOK` env vars are absent.
- Missing image inputs fail before a visual handoff is produced.
- `tedge drill` fails when no requested providers are available instead of
  returning an empty successful run.
- `tedge prefs` now prints readable guidance and available preference keys
  instead of silently returning `{}`.
- `tedge export --brief` provides a compact terminal summary without flooding
  the screen with artifact contents.
- TUI/replay startup falls back to a static cockpit summary when the terminal
  does not support raw input mode.
- TUI agent list keys are stable even when the same role runs multiple times.
- `review-export` is visible in CLI help and supports command-specific help.

### Merged

- PR #16: provider diagnostics, live patch reliability, context exclusion,
  fallback trace events, and patch parser hardening.
- PR #13: first-run config ergonomics, fixture-mode alias, env shadow warnings,
  agent offline/live visibility, and provider budget defaults.
