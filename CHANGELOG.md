# Changelog

All notable changes to TomorrowEdge will be documented in this file.

This project follows the common open-source changelog shape inspired by Keep a
Changelog: newest changes first, grouped by release and by change type.

## [Unreleased]

## [0.5.1] - 2026-06-05

### Added

- OpenRouter onboarding model discovery via `tedge models --refresh-free`,
  with live free/low-cost recommendations that prefer Kimi K2.6 free when
  available.
- `tedge models --configure-free <model-id>` for explicitly enabling a chosen
  OpenRouter free/low-cost model, plus `--free-first` to bind low-risk execution
  roles to that model.
- `tedge models --connection-test` for lightweight post-key HTTP `/models`
  connectivity checks before chat smoke tests.
- `model_discovery` config defaults for recommendation-only onboarding.
- Native Anthropic Messages API provider adapter with `x-api-key`,
  `anthropic-version`, text, and image URL/data URL payload translation.
- Native Gemini `generateContent` provider adapter with `x-goog-api-key`, text,
  and data URL image payload translation.
- End-to-end workflow case study and troubleshooting guide for provider setup,
  MCP invocation, full mode, release archives, and Windows markdown encoding.

### Changed

- `tedge init` now guides first-run users toward OpenRouter as an optional
  starter provider and recommends separate API keys for cost tracking,
  rate-limit isolation, and provider failure diagnosis.
- `tedge doctor`, provider routing profiles, connection tests, README provider
  matrix, and CI now treat Anthropic/Gemini as real native providers instead of
  placeholders.

## [0.5.0] - 2026-06-04

### Added

- Conversation Targets for natural-language routing to `core`, `planner`,
  `reviewer`, `judge`, `debate`, or enabled `agent:<id>` external agents.
- `tedge targets` for listing available conversation targets.
- `tedge ask --to <target> "<message>"` for non-mutating directed conversation
  traces.
- `tedge run --to <target> "<task>"` for full workflows that preserve the user's
  chosen communication object in the session.
- `tedge tui --to <target>` for opening the cockpit with an explicit displayed
  communication object.
- `conversation_target` and `conversation_message` events in `events.jsonl`,
  trace, and artifact-aware exports.
- TUI Goal pane target display so operators can see who the current message is
  addressed to.

### Changed

- Upgraded `examples/tiny-local-lm` from a 935-parameter character n-gram toy to
  a local bilingual Chinese/English hashed neural n-gram model with roughly
  50M parameters by default.
- Hardened context hygiene so common binary/image assets are excluded from safe
  text context and omitted from live patch prompts.
- Hardened patch application for empty diffs, missing targets, bounded stale
  context, and ambiguous changed-substring fallbacks.
- Reviewer/Judge gates now enforce parseable diffs, diff-target consistency,
  verification plans, encoding hygiene, and blocking concern handling before
  automatic selection.
- External agent workflow debate now asks for explicit reviewer/judge stances,
  cross-examination questions, and required evidence.

## [0.4.1] - 2026-06-04

### Added

- External MCP process runtime for configured Claude Code / Codex-style stdio
  agents, including `tedge mcp agents --probe` and `tedge mcp invoke`.
- Active external-agent participation in workflow debate, cross-examination,
  and judge/reviewer-style delivery turns.
- External-agent cost visibility in the TUI Memory pane and workflow reports.
- `npm run verify` release gate covering tests, build, secret scan,
  high-severity audit, and dry npm packing.
- External command runner skeleton for configured role-bound agents, with stdin
  and temp-file context handoff plus `external_agent_call/result/error` events.
- Local `examples/tiny-local-lm` acceptance demo with a tiny char-level n-gram
  model, `/health`, `/model-info`, `/generate`, frontend controls, and tests.

### Changed

- MCP Agent Bridge docs now distinguish Codex's `mcp-server` path from Claude
  Code setups that need a stdio MCP wrapper or future server command.
- Full access shell execution now defaults to `unrestricted`; partial mode
  defaults to approval-required shell execution; verification allowlists are an
  explicit CI/demo shell policy.
- `secrets:scan` works outside a git checkout by falling back from
  `git ls-files` to fast-glob.

### Usage

- Run the full release gate with `npm run verify`.
- Use `shell.policy: verification_allowlist` only for CI/demo verification
  lanes; full mode remains Codex-style unrestricted execution with ledgered
  shell events.
- Run the local toy LM demo with `cd examples/tiny-local-lm && npm install &&
  npm start`.

## [0.4.0] - 2026-06-04

### Added

- MCP Agent Bridge skeleton with `tedge mcp serve`, `tedge mcp tools`, and
  `tedge mcp agents`.
- External MCP agent registry, role binding via `external:<id>`, and
  `external_agent_*` event ledger visibility for patch/review/judgment/result
  handoffs.
- Docs for MCP external agent roles and Claude Code / Codex cockpit integration.
- WSL-safe `tsx` dev wrapper for `npm run dev`, `doctor`, `tui`, and
  `smoke:real`.

### Usage

- Start the MCP stdio server with `tedge mcp serve`.
- Inspect exposed MCP tools with `tedge mcp tools`.
- Inspect enabled external MCP agents with `tedge mcp agents`.
- Enable role-bound external agents with `external_agents.<id>.enabled=true`.
- Bind workflow roles with `agents.<role>.provider: external:<id>`.
- Review external agent activity with `tedge trace latest --verbose` or the TUI
  Trace pane.

### Changed

- Kimi/Moonshot default model is now `kimi-k2.6` with
  `https://api.moonshot.ai/v1`.
- `tedge workflow` now reassigns roles to available requested providers instead
  of hardcoding OpenRouter/DeepSeek/MiMo.

### Fixed

- Workflow runs no longer produce unavailable role gaps when the requested
  provider set omits OpenRouter or MiMo but includes another usable provider.

## [0.3.0] - 2026-06-03

### Added

- `tedge run --live` and `tedge run --offline` for explicit live/offline
  execution selection.
- Automatic non-mutating live routing when configured cloud providers and API
  keys are available.
- Provider matrix in README distinguishing usable, local, and placeholder
  adapters.
- CLI contract test for `tedge --version`.

### Changed

- CLI version output now reads from `package.json` instead of a hardcoded
  string.
- OpenAI-compatible provider timeout default increased to 120 seconds and now
  retries 429/5xx transient failures.
- Kimi default base URL now uses the Moonshot OpenAI-compatible endpoint.
- CI now runs on both Node `20.19.x` and `22.x`.
- `tedge doctor` reports placeholder orchestration backends and full-mode dirty
  workspace warnings earlier.

### Fixed

- Live patch and live vision JSON responses are validated with Zod before being
  normalized into downstream objects.
- `docs/CONFIG.md` now accurately distinguishes currently enforced autonomy
  bounds from planned bounds.

## [0.2.0] - 2026-06-03

### Added

- First-run init options for access mode, routing mode, test command,
  provider/model enablement, and cloud repo-context policy.
- Productized `tedge doctor --json` diagnostics with provider status, fix hints,
  placeholder detection, URL validation, and price visibility.
- Shell execution guard for full/partial mode that blocks metacharacters,
  dangerous executables, and commands outside the verification allowlist.
- Event/artifact redaction layer with expanded token detection for common
  provider and platform secrets.
- Task-relevant context selection based on goal/plan keywords, path/content
  matches, source/test metadata, and expected file hints.
- Patch application rollback when a later file write fails.
- Productization baseline and milestone roadmap docs.
- Package metadata, `typecheck`, CLI smoke script, and CI smoke/typecheck steps.

### Changed

- Version bumped to `0.2.0`.
- Shell commands now run through `execa(file, args, { shell: false })` instead
  of `shell: true`.
- IDs are generated with `crypto.randomUUID()` instead of `Math.random()`.
- Anthropic and Gemini now register as explicit placeholder providers with clear
  errors instead of pretending to be OpenAI-compatible adapters.

### Fixed

- Secrets in prompts, responses, stdout, stderr, provider errors, and exported
  artifacts are redacted before they are persisted.
- Multi-file patch application no longer leaves already-written files modified
  when a later write fails.

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
