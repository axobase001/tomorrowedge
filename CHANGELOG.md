# Changelog

All notable changes to TomorrowEdge will be documented in this file.

This project follows the common open-source changelog shape inspired by Keep a
Changelog: newest changes first, grouped by release and by change type.

## [Unreleased]

## [1.1.3] - 2026-06-07

1.1.3 is a GUI command-composer hotfix.

### Fixed

- Pressing Enter in the GUI natural-language composer now sends the command
  instead of inserting a newline.
- Shift+Enter still inserts a newline, and IME composition is protected so
  Chinese/Japanese/Korean input is not submitted mid-composition.

## [1.1.2] - 2026-06-07

1.1.2 adds an optional local desktop app window while keeping the GUI client
and local cockpit server as the single source of runtime truth.

### Added

- `tedge desktop` CLI command and `npm run desktop` script for opening
  TomorrowEdge in a standalone local desktop window.
- Optional desktop runtimes:
  - `auto`: Electron when installed, then Chromium/Edge app-window mode, then a
    normal local browser fallback.
  - `app-mode`: system Chromium/Edge app-window mode without adding Electron.
  - `electron`: Electron shell when the optional Electron package is installed.
- Minimal Electron main-process shell under `desktop/electron-main.cjs`.

### Changed

- README now documents the difference between `client` and optional `desktop`
  startup modes.

## [1.1.1] - 2026-06-07

1.1.1 is a GUI client entrypoint and landing-page cleanup release.

### Added

- `tedge client` CLI command and `npm run client` script for opening the
  TomorrowEdge GUI Client directly.

### Changed

- README now presents one clear GUI client path and hides the TUI screenshot /
  intro and UI style explainer from the landing flow.
- Local cockpit title, empty-state copy, and server output now say
  "TomorrowEdge GUI Client" instead of the older local-cockpit wording.

## [1.1.0] - 2026-06-07

1.1.0 refines the browser cockpit into the TomorrowEdge GUI Client: a quiet
local coding-agent cockpit while keeping the agent graph, routing, approval,
shell-policy, event-ledger, and terminal runtime core intact.

### Added

- Shared cockpit ViewModel contracts under `src/cockpit/` so GUI and future TUI
  surfaces can consume consistent task, workflow, telemetry, approval, trace,
  and artifact state.
- Local cockpit view-model endpoint and live run event stream for browser
  surfaces.
- Vite/React cockpit skeleton under `src/cockpit-web/` for the next staged GUI
  surface.
- image2-first GUI prompt pack, generated reference boards, component selection
  notes, implementation mapping docs, and GUI v1.1 runtime screenshots.
- Unit coverage for cockpit ViewModel projection and local cockpit view-model /
  approval-intent endpoints.
- `tedge client` and `npm run client` as the recommended GUI client entrypoint.

### Changed

- Browser cockpit now uses the Four-Zone Quiet Cockpit layout: reduced task
  queue, lighter workflow spine, summary-first approval workspace, collapsed
  telemetry, and a compact natural-language command composer.
- Browser approval actions now execute real Node-side workflow actions instead
  of only recording browser intents: approve/reject patch, approve/reject shell,
  request re-review, and undo latest patch.
- Live cockpit SSE snapshots now carry shared ViewModel updates so workflow,
  task state, telemetry, approval focus, and trace can update during runs.
- README now presents the GUI client as the primary operator surface with
  runtime screenshots captured from `tedge client`.
- README hides the TUI screenshot/intro and UI style explainer from the landing
  flow so first-time users see one clear client path.

### Fixed

- Local cockpit auth now compares token byte lengths before
  `timingSafeEqual`, avoiding multibyte-token crashes.
- Malformed cockpit JSON requests now return `400 invalid_json` instead of
  falling through as server errors.
- Detail drawer positioning is constrained to the viewport and includes full
  diff, changed files, telemetry, routes, artifacts, and raw event trace.
- Telemetry displays `not measured` or `-` when cost/token/cache data is absent
  instead of misleading zero values.
- `npm run package:zip` creates shareable archives that exclude `.env*` and
  validates the resulting zip before reporting success.

## [0.6.0] - 2026-06-05

0.6.0 starts the Architecture Upgrade track. It keeps TomorrowEdge focused on a
full-access coding workflow cockpit, while adding the first context,
evidence, diagnostics, budget, and external handoff layers inspired by
OpenSquilla's artifact/context split.

### Added

- Context Projection layer with runtime artifact views, provider views, and
  reducers for stdout, stderr, diffs, files, test logs, and JSON.
- Evidence Packet layer for patch, review, judge, and test evidence, with
  `evidence_packet` events and model-visible packet text.
- `artifact_projection` and `context_projection` events so traces show what was
  preserved as full artifact data and what was projected to model context.
- `routing_decision`, `budget_decision`, `workflow_stop_reason`,
  `fallback_to_native`, and `trace_completeness` events.
- `tedge trace latest --diagnostics` and `tedge diagnostics latest` for routing,
  fallback, projection, budget, repair, and trace-completeness inspection.
- Typed external-agent handoff contracts for task, result, patch, review, and
  judge envelopes.
- Role-routing policy scaffolding and strong-agent budget scaffolding.
- Architecture and positioning docs:
  `docs/CONTEXT_PROJECTION.md`, `docs/EVIDENCE_PACKETS.md`,
  `docs/ARCHITECTURE_UPGRADE.md`, `docs/COMPARISONS.md`,
  `docs/PRODUCT_POSITIONING.md`, `docs/WHY_TOMORROWEDGE.md`, and
  `README.product.md`.

### Changed

- Reviewer and Judge roles can consume structured evidence packets alongside
  patch candidates, reviews, and judge decisions.
- External role invocation now passes a typed task envelope and accepts result
  envelopes via `payload`.
- README current-version section now describes Architecture Upgrade Phase 1.

## [0.5.2] - 2026-06-05

0.5.2 is an experience-polish release. It narrows the first-run path, clarifies
full-access shell semantics, labels real MCP integration status, and makes
external-role fallback visible in traces instead of silently falling back.

### Added

- README and GitHub Pages now include a short 3-minute no-key tryout path that
  runs the offline fixture workflow, verification, trace, and TUI.
- Native workflow roles can execute through configured external MCP agents,
  allowing external `core`, `coder_a`, `reviewer`, `judge`, and `repairer`
  roles to return structured plans, patch candidates, reviews, and judgments
  directly into the event ledger.
- `external_agents.<id>.proxyPort` for injecting per-agent localhost proxy
  environment variables into external MCP processes.
- MCP Agent Bridge docs now include a status table for Codex CLI, Claude Code,
  mock external agents, and custom MCP agents.
- Roadmap now has explicit 0.5.x experience polish, 0.6.x real external-agent
  workflow, and 0.7.x benchmark-demo milestones.

### Fixed

- Codex MCP stdio support now handles newline-delimited JSON-RPC framing and
  recognizes common Windows launchers such as `codex.cmd`, `codex.exe`, and
  `codex.ps1`.
- External role payloads that cannot be normalized into internal Plan/Patch/
  Review/Judge shapes now write `external_agent_error` events before falling
  back to native agents.

### Changed

- README, `docs/CONFIG.md`, and `docs/PERMISSIONS.md` now clarify that
  `shell.policy: unrestricted` means unrestricted executable invocation with
  `shell: false`, not raw shell-script execution with metacharacters.
- Tiny local LM docs remain consistently framed as a 50M-60M local toy model;
  old 540k references remain only inside patch-regression fixtures.

## [0.5.1] - 2026-06-05

0.5.1 is the first post-0.5 hardening release. It turns the project from a
promising cockpit prototype into a more usable early open-source package:
provider onboarding is easier, Anthropic/Gemini are real native adapters, the
release gate is stricter, and the large issue/PR backlog from the first public
feedback pass has been folded into the main branch.

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
- CI now runs `npm run secrets:scan` in addition to test, typecheck, build,
  smoke, audit, and dry package checks.
- Local LM frontend screenshots are included in the example README so users can
  inspect the runnable demo before starting it.

### Changed

- `tedge init` now guides first-run users toward OpenRouter as an optional
  starter provider and recommends separate API keys for cost tracking,
  rate-limit isolation, and provider failure diagnosis.
- `tedge doctor`, provider routing profiles, connection tests, README provider
  matrix, and CI now treat Anthropic/Gemini as real native providers instead of
  placeholders.
- README, provider docs, roadmap, productization baseline, and scope status were
  updated to match the real provider state.
- The 0.5.1 package metadata, lockfile, README current version, changelog, git
  tag, and GitHub Release now agree on the same release number.

### Fixed

- TUI approval keys are gated by access policy so restricted/partial/full modes
  cannot be bypassed from the cockpit.
- Static/non-interactive TUI output now shows target, routing, access detail,
  and recent trace context instead of hiding the important workflow state.
- Full-mode and partial-mode traces are easier to distinguish, with clearer
  access semantics and pending-action prompts.
- Real model patch generation is more reliable through JSON response-format
  requests and robust JSON extraction for non-OpenAI providers.
- Release dry packing refuses untracked files that would accidentally enter the
  npm package.
- `npm run verify` is hardened for registries that do not expose the audit
  endpoint.
- MCP tool schemas are tighter for role-bound external agents, and brief export
  reports stored artifact counts instead of duplicate refs.
- Executor verification can run multi-step verification plans and repair reruns
  the failing shell command instead of only the first command.
- Autonomy limits now enforce wall-time/cost guardrails in the executor.
- Budget status is preserved across workflow sections instead of being
  overwritten by the latest section.
- Provider registry creation is cached for repeated chat fallback calls.
- `.env`-dependent defaults are read after local environment loading rather than
  at module import time.
- Shell command splitting handles backslash escaping.
- Summarizer failure no longer destroys the whole workflow result.
- Workflow reports are written as UTF-8 with BOM to avoid Chinese markdown
  corruption in common Windows viewers.
- `tedge run` supports `--cwd` / `--workdir` for targeting external project
  directories.
- `tedge tui --session latest|<id>` can open saved sessions.
- Workflow and drill provider flags are more consistent through `--include-mock`.
- Create/delete patches are supported by the patch parser and applier.
- Tiny local LM startup and test speed are improved by lazy dense-parameter
  initialization.

### TUI / UX

- Memory/budget/cost visibility moved higher in the cockpit.
- Help layout no longer wastes the bottom half of the screen.
- Debate pane shows review scores instead of only truncated summaries.
- Agent cards show elapsed duration and distinguish patch/shell runner kinds.
- Diff pane can inspect alternate and repair candidates.
- Shell pane shows actual command output, exit code, and failure content.
- Trace pane shows a larger recent-event window and total count.
- Command palette copy now explains that model-route preview is temporary until
  persisted through config/preferences.

### PRs Merged

- #82 Gate TUI approval actions by access policy.
- #69 Align the 0.5 CLI surface.
- #67 Harden release verify gates.
- #60 Add 0.5.0 black-box contract coverage.
- #58 Fix real model patch generation JSON handling.
- #48 Apply v0.5 audit hardening for stale versions, redundant I/O, tool
  selection, and security docs.
- #41 Clarify access modes and static cockpit fallback.
- #35 Tighten MCP schemas and brief export counts.

### Issues Closed In This Hardening Pass

- Access and TUI approval semantics: #74, #71, #38, #27.
- TUI cockpit visibility and layout: #79, #78, #77, #76, #75, #73, #70, #68,
  #52, #39.
- Executor, verification, repair, and autonomy: #81, #80, #62, #61, #43.
- Provider, fallback, JSON, env, and routing behavior: #66, #65, #64, #49, #46,
  #42, #21, #20, #18.
- Patch, shell, and report correctness: #63, #45, #44, #40, #34.
- MCP, export, and trace contracts: #57, #56, #55, #54, #53, #51, #50, #32,
  #31.
- Release and packaging gates: #47, #37, #36, #33.

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
