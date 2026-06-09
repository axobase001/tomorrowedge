# Changelog

All notable changes to TomorrowEdge will be documented in this file.

This project follows the common open-source changelog shape inspired by Keep a
Changelog: newest changes first, grouped by release and by change type.

## [Unreleased]

### Added

- Authenticated encrypted local provider secret storage for GUI setup and the
  `Keys` panel, backed by `.tomorrowedge/secrets.enc` while preserving
  env-var based provider configuration.
- Structured failure memory records for failed or partial saved sessions,
  including failure class, correction strategy, confidence, recurrence, and
  artifact refs without raw bulky artifact content.
- `tedge memory failures`, `tedge memory show <id>`, and
  `tedge memory explain "<task>"` for local failure-memory inspection,
  JSON export, and retrieval rationale.
- `tedge experiment error-loop` for deterministic no-key error-loop runs with
  manifest, trial JSONL, retrieval decisions, memory records, metrics, and a
  Markdown report.
- Error-loop research caveats and falsification criteria in
  `docs/ERROR_LOOP_RESEARCH.md`.
- Failure-memory v2 lifecycle metadata, including stable failure signatures,
  project/dependency scope, first/last seen timestamps, source session IDs,
  recurrence counts, stale detection, and retrieval rejection reasons.
- Failure-memory workflow influence: planner pre-mortems, coder-visible memory
  constraints, reviewer/judge memory guards, and repair-context correction
  retrieval, all recorded as `memory_retrieval` events.
- GUI/detail drawer memory-influence cards that show retrieved memory ids,
  status, injected role, matched features, decision impact, violations,
  alignment, and artifact links.
- GUI/detail drawer error-loop timeline that reconstructs candidate attempts,
  patch applications, failed/passed verification, repair attempts, memory
  retrieval, artifact refs, and stop reasons from the shared event ledger.
- Failure-memory consent controls via `failure_memory.enabled`, storage scope,
  redaction level, retention days, plus `tedge memory preview/export/delete/compact`.
- Repair-policy trace events that classify failed verification runs, choose the
  next repair action, and escalate repeated same-signature failures instead of
  silently repeating the same repair strategy.
- Outcome prediction and observation trace events for patch, shell, and repair
  attempts, with mismatch classification, GUI timeline cards, failure-memory
  references, and experiment prediction-accuracy reporting.
- Direct unit coverage for agent classes, project tools, and safety boundary
  helpers.

### Changed

- Cockpit E2E smoke now treats GUI `data-testid` attributes as an explicit
  contract across setup, key management, composer, workflow, telemetry,
  approval, trace, and drawer surfaces.
- `runOfflineGraph` now delegates to named workflow phases for routing intent,
  core, vision, planning, exploration, candidate generation, review/judge,
  advisory, patch application, and verification/repair instead of keeping the
  full orchestration inside one long entrypoint.
- GUI provider setup no longer writes newly pasted API keys to plaintext
  `.tomorrowedge/local.env`; that path remains read-compatible for existing
  installations.
- Error-loop experiment exports now report explicit `memoryUpdateStatus`
  reasons such as `written`, `skipped_no_failure`, and `skipped_ablation`
  instead of implying learning whenever a workflow fails.
- Repeated matching failure memories are merged instead of appended as duplicate
  rows; error-loop metrics now separate new memory writes from recurrence
  observations and suspected negative transfer.
- Failure-memory retrieval now rejects stale or low-confidence records before
  scoring, reducing negative transfer from old project state or irrelevant
  memories.
- `strategy_memory` now has independent ablation switches for
  `failure_premortem`, `coder_constraints`, `review_guard`, and
  `repair_context`.
- Failed or partial sessions no longer silently write failure-memory records in
  normal project runs; experiments opt in explicitly and mark memory as
  experiment-scoped.

## [1.2.14] - 2026-06-09

1.2.14 clears the P0-P2 issue sweep for provider routing, trace quality, GUI
workflow usability, session management, and stronger debate orchestration.

### Added

- OpenRouter model canonicalization for GUI/setup/role saves, including display
  labels such as `MoonshotAI: Kimi K2.6 (free)` and stale Kimi K2 defaults.
- Dynamic model discovery for OpenAI-compatible provider families beyond
  OpenRouter, including DeepSeek, Kimi, MiMo, Anthropic, Gemini, Ollama, and
  custom gateways, with static fallback suggestions when catalog calls fail.
- Clickable artifact links in the GUI detail drawer and task-goal labels in the
  saved-session selector.
- Local cockpit session rename/delete API and GUI controls.
- Pre-judge live reviewer/judge advisory rounds that are converted into debate
  evidence before the native judge selects a candidate.
- Workflow simulation now runs through the NativeBackend dry-run path and
  projects the shared executor event ledger into the legacy workflow report.

### Changed

- `tedge trace latest --verbose` now summarizes huge context-selection
  exclusions instead of printing thousands of ignored/session artifact paths.
- GUI final and failure panels now show user-facing task result, changed files,
  verification status, root-cause candidates, stdout/stderr snippets, and next
  actions instead of only raw trace references.
- Live cockpit snapshots now absorb `model_call` and `agent_run` events into
  agent status and telemetry.
- Capability status now distinguishes implemented env/local-env API key storage
  from proposed OS keychain / encrypted secret storage.

### Fixed

- OpenRouter free-model display labels are no longer stored as invalid model IDs
  that later fall back to mock execution.
- Provider connection tests now smoke-test the selected configured model instead
  of only checking catalog access.
- Missing sessions now return `404` from local cockpit session routes instead of
  bubbling into generic server failures.
- Flat legacy session records are deleted as files rather than deleting the
  entire sessions directory.
- Local cockpit and desktop launch URLs no longer include the per-process nonce
  in the browser address bar; generated clients use runtime config plus
  cookie/header auth, with query nonce kept only for old-link compatibility.
- Role-specific strong-agent budgets now still debit the global strong-agent
  pool, preventing reviewer/judge/planner calls from bypassing the task budget.
- Parallel candidate execution now normalizes candidate-stage agent state before
  review, so asynchronous coder completion order cannot reorder the workflow.
- Document-only deliverables such as `.md`/`.html` files no longer default to a
  full repository `npm test` verification run that can mislabel a successful
  document patch as failed.

## [1.2.13] - 2026-06-09

1.2.13 clears the next GUI orchestration and provider-configuration issue batch.

### Added

- GUI composer target routing for `core`, `planner`, `reviewer`, `judge`,
  `coder`, `repairer`, and `debate`.
- GUI run mode selection for `auto`, isolated `fixture`, local `offline`, and
  configured-provider `live` runs.
- Detail drawer RoleGraph section with workflow kind, role dependencies,
  required/optional nodes, fallback/skip flags, and stop conditions.
- GUI support for adding custom OpenAI-compatible gateway providers.
- GUI key manager model recommendations via a local `/api/setup/models`
  endpoint, including OpenRouter free/low-cost catalog refresh and static
  fallback suggestions for common providers.

### Changed

- GUI composer input now clears once a run is accepted; the submitted command
  remains in the session goal, task card, and trace ledger.
- Local cockpit `/api/runs` now uses the orchestration backend registry instead
  of calling the native graph directly.
- GUI runs now honor the same project preferences and strategy-memory hints used
  by CLI runs.
- GUI fixture demos now execute in an isolated sample workspace instead of the
  current project directory.
- Live patch and advisory provider calls now emit invocation-time
  `budget_decision` events in addition to routing-time `budget_preview` events.
- Existing configured provider keys can now be reused while saving only model,
  base URL, or env-var metadata changes; entering a new key remains explicit
  secret rotation.

### Fixed

- Chinese file-creation tasks with read-only constraints are classified as patch
  workflows when they explicitly ask to create/write/generate files.
- Pending patch authorization is no longer displayed as rejected approval
  history.
- Patch approval failures now leave the waiting-approval state, show a failed
  workflow diagnosis, and reject repeat approvals for stale approval ids.
- Project-relative add-file paths under new directories are no longer rejected
  as escaping the workspace root.
- Obvious mojibake additions and malformed generated HTML closing tags are
  blocked before a patch is surfaced for approval.
- GUI first-run readiness now recognizes explicitly routed no-auth local
  providers such as Ollama and enabled external MCP agents, so configured local
  or external runtimes no longer fall back to fixture mode.
- The GUI key manager no longer leaks a model typed for one provider into the
  next selected provider.

## [1.2.12] - 2026-06-09

1.2.12 closes the high-priority orchestration and GUI trace issue batch.

### Added

- Built-in workflow recipes: `review-only`, `bugfix-sprint`, and
  `security-audit`, plus `tedge recipes` and `tedge run --recipe <id>`.
- Planner/explorer in-process result caching with `agent_cache` ledger events
  and repository-fingerprint invalidation for explorer context.
- Native judge decisions now consume debate rounds, and external judge context
  receives the same debate evidence.

### Changed

- Coder-A, Coder-B, and live patch candidate generation now start in the same
  candidate-production stage, then merge candidates in a stable review order.
- Auto-started external MCP process clients are reused during workflow role
  calls and released at workflow finalization.

### Fixed

- GUI detail drawer route rows now include routing reasons.
- Failed-verification repair approvals now surface as repair approval cards and
  browser approval applies the repair candidate instead of the stale patch.
- External MCP process shutdown now waits for exit/close so Windows fixture
  workspaces are not left locked.

## [1.2.11] - 2026-06-09

1.2.11 hardens the native runtime governance loop.

### Added

- BudgetGate runtime layer with allow/fallback/block decisions immediately
  before live or external role invocation.
- `budget_preview` events so routing can show budget implications without
  consuming budget.
- WorkflowKind-aware trace completeness for `read_only`, `patch`,
  `vision_patch`, `advisory`, and `ask_user` workflows.
- RoleGraph foundation for workflow-kind-aware orchestration, including
  read-only, patch, debate patch, high-risk patch, and repair-loop graphs.

### Changed

- Workflow intent is classified before model-backed patch planning.
- Routing and post-plan rerouting now remain route proposals; actual budget
  decisions are recorded only at invocation time.
- Native/offline execution is distinguished from cloud/external route
  proposals in agent run state.

### Fixed

- Budget-blocked external planner/reviewer/judge roles no longer call the
  external agent and no longer produce blocked+success contradictions for the
  same actual invocation.
- Read-only workflows no longer lose trace-completeness score for intentionally
  skipped patch, review, judge, apply, or shell events.

## [1.2.10] - 2026-06-09

1.2.10 promotes the planner/routing/budget governance upgrade to a release.

### Added

- Model-backed planning path with a strict structured JSON contract and native
  adaptive fallback.
- Per-role budget controls through `agents.<role>.budget`, including independent
  call and cost caps for planner/reviewer/judge/coder roles.

### Changed

- Native planning is now adaptive: plan length and phases vary by task type,
  risk, and constraints instead of always emitting the same fixed workflow.
- Routing can rerun after Planner output, allowing downstream roles to respond
  to task risk, privacy requirements, user overrides, and required capabilities.

### Fixed

- Several previously quiet catch fallbacks now emit diagnostic logs for
  non-benign failures while keeping normal new-file patch validation quiet.
- The GUI key/role modal header stays visible while scrolling long provider
  configuration lists.

## [1.2.9] - 2026-06-09

1.2.9 extends provider compatibility fixes beyond DeepSeek.

### Added

- GUI first-run setup and the `Keys` panel now expose provider base URL fields
  so OpenAI-compatible gateways, MiMo regional endpoints, and custom compatible
  APIs can be configured without hand-editing YAML.

### Changed

- MiMo and generic OpenAI-compatible providers now ship with known default
  endpoints instead of blank `base_url` values.
- Older configs with blank `base_url` entries are normalized for DeepSeek, MiMo,
  and generic OpenAI-compatible providers at load time.

### Fixed

- Custom base URLs submitted from the GUI are now persisted by the local cockpit
  API instead of being dropped by request parsing.

## [1.2.8] - 2026-06-09

1.2.8 fixes DeepSeek onboarding and connection testing from the GUI key manager.

### Fixed

- DeepSeek now has a known default endpoint of `https://api.deepseek.com`.
- Older configs with an empty DeepSeek `base_url` are normalized at load time so
  GUI connection tests no longer fail with `base_url missing` after a user saves
  only the API key, env name, and model.
- Regression coverage verifies both config migration and GUI key-save readiness
  for DeepSeek.

## [1.2.7] - 2026-06-09

1.2.7 adds first-class GUI language switching for the local client.

### Added

- Top-bar language selector with English as the default and Chinese as an
  operator-selectable option.
- Local browser persistence for the selected GUI language.
- React and Playwright coverage for default English rendering and Chinese
  switching.

### Changed

- Core GUI chrome, setup wizard, composer, workflow, telemetry, trace, approval,
  key/role management, and detail drawer copy now flow through the GUI i18n
  layer while event ledger payloads and model outputs remain unchanged.

## [1.2.6] - 2026-06-09

1.2.6 rebuilds the community API key and role management idea on the safer
existing TomorrowEdge setup path.

### Added

- GUI `Keys` panel for simple provider API-key setup and per-role model
  assignment.
- Local cockpit API endpoints for provider key save/delete and role assignment
  updates.
- Setup status now reports role assignments and masked key status, without
  returning raw API keys to the browser.
- E2E coverage for opening the `Keys` panel and switching to role assignment.

### Changed

- Provider keys entered through the GUI are stored in `.tomorrowedge/local.env`
  and config continues to keep only env-var references. This supersedes the
  closed backend secret-storage PR without adding unauthenticated custom crypto
  or excluding secret-management source from scans.

## [1.2.5] - 2026-06-09

1.2.5 tightens GUI E2E coverage for the cockpit paths that operators touch most
often.

### Changed

- Cockpit E2E smoke now verifies telemetry routing display, drawer open/close,
  and the end-to-end approval path from patch approval through shell approval to
  completion.
- The detail drawer close button now uses the explicit
  `detail-drawer-close` test selector.

## [1.2.4] - 2026-06-09

1.2.4 clears the latest community GUI and configuration issue batch while
keeping riskier automation/security PRs out of the release path for further
review.

### Added

- MCP-aware agent provider reference validation at config load time. Agent
  routes now fail early for unknown providers while still allowing `auto` and
  `external:<agent-id>` bindings when the external agent profile exists.
- Regression coverage for read-only natural-language inspection, empty no-op
  patch candidates, session selector refresh, and first-run setup defaults.

### Changed

- Absorbed the safe parts of the latest community PRs for GUI aria labels,
  empty composer validation, current running-agent display, telemetry routing,
  mock/demo labels, and README version hygiene.

### Fixed

- GUI sessions created by a live run remain selectable after completion instead
  of disappearing until a manual refresh.
- First-run setup no longer preselects mock/fixture provider values as if a
  live provider were configured.
- Dismissing the fixture demo setup prompt is remembered for the browser
  session.
- Empty/no-op patch candidates no longer create misleading patch approval
  cards.
- Read-only inspect requests no longer treat ordinary words such as `provider`
  as missing filesystem paths.

## [1.2.3] - 2026-06-08

1.2.3 fixes GUI tasks that are semantically read-only but were incorrectly sent
through the patch approval workflow.

### Added

- Model-driven workflow intent routing before patch generation. TomorrowEdge now
  asks the planner-routed model whether a command is `inspect`, `patch`, or
  `ask_user`, records the decision as a `workflow_intent` event, and uses that
  decision to choose the workflow path.
- Read-only local inspection finalization for commands such as listing a folder
  or outputting a file structure, so the cockpit can complete without generating
  empty patch candidates.

### Fixed

- Read-only GUI commands no longer stop at `Waiting for patch approval` with
  `0 file(s) changed`.
- Restricted/no-key runs use the local mock intent model instead of calling a
  cloud provider for intent classification.
- Release verification now gives IO-heavy fixture tests enough timeout budget on
  Windows instead of relying on Vitest's 5s default.

## [1.2.2] - 2026-06-08

1.2.2 is a small GUI and release-packaging hardening release after the latest
community PR sweep.

### Added

- Encrypted API key storage ADR is now included in package/release artifacts so
  the planned secure-key path is visible to downstream users and reviewers.

### Changed

- GUI live-model runs remain opt-in through explicit live flags: configured
  providers can run live, while no-key onboarding and restricted mode continue
  to use the fixture workflow.

### Fixed

- Sanitized the encrypted-key ADR wording so `secrets:scan` does not flag
  documentation examples as real API keys.
- Package metadata now includes `docs/adr/*.md`, keeping architecture decisions
  in the published package.

## [1.2.1] - 2026-06-08

1.2.1 is a local-startup patch release for fresh checkouts and dev users.

### Fixed

- Local dev GUI startup now builds React cockpit assets before `client`,
  `desktop`, or `serve`, so a fresh checkout no longer falls back to the older
  embedded HTML cockpit when `dist/cockpit-web` is missing.

## [1.2.0] - 2026-06-08

1.2.0 turns the GUI client into a friendlier first-run cockpit instead of a
configuration maze.

### Added

- First-run GUI setup wizard for selecting a provider, entering at least one
  model id, and configuring either an API-key environment variable or a local
  `.tomorrowedge/local.env` key.
- Local setup API endpoints for setup status, provider configuration, and
  provider connection checks.
- Access-mode dropdown beside the natural-language composer so operators can
  switch `restricted`, `partial`, and `full` before sending a task.
- Setup tests, React rendering coverage, and cockpit E2E handling for the
  first-run fixture-demo path.

### Changed

- OpenRouter is recommended as the easiest onboarding provider, but cheap-first
  and strong-review routing remain optional rather than forced.
- GUI runs now use the composer-selected access mode instead of always starting
  in partial mode.

## [1.1.10] - 2026-06-07

1.1.10 clears the repeated GUI theming and responsiveness issue batch.

### Added

- React cockpit and fallback HTML cockpit now both define dark-mode CSS variable
  overrides through `prefers-color-scheme: dark`.
- CSS regression coverage verifies dark-mode support and prevents the fallback
  HTML cockpit from reintroducing `1080px` / `980px` hard min-width locks.

### Fixed

- The fallback HTML cockpit no longer hard-locks `.cockpit-shell` to 1080px or
  the 1180px breakpoint to 980px; it now degrades into flexible columns before
  the single-column mobile layout.

## [1.1.9] - 2026-06-07

1.1.9 clears the capability-dashboard GUI issue cluster.

### Added

- Productized cockpit capability registry for workflow ledger, provider
  routing/model availability, evidence/budget/cost telemetry, MCP external
  agents, orchestration adapters, and the GUI client.
- Shared ViewModel capability summaries with status, category, readiness notes,
  and implementation/documentation refs.
- Detail drawer capability dashboard that distinguishes available,
  experimental, scaffold, and unavailable-style readiness instead of relying on
  README prose alone.

## [1.1.8] - 2026-06-07

1.1.8 clears the approval-history GUI issue cluster by projecting approval
events into a readable drawer timeline.

### Added

- Shared `approvalHistory` view-model items with approvalId, kind, status,
  action, actor/source, blocking state, filter tags, changed files, diff refs,
  shell output refs, duration, and undo snapshot ids.
- Detail drawer approval timeline that connects waiting approvals, approved or
  rejected patch actions, shell approvals, re-review requests, and undo events.
- Tests for waiting patch approval history, shell approval history, fixture
  markers, and rendered drawer history.

## [1.1.7] - 2026-06-07

1.1.7 clears the GUI session-source issue cluster so the cockpit no longer
leaves operators guessing whether they are viewing a live run, saved snapshot,
fixture demo, or unavailable API state.

### Added

- Shared `sessionMeta` view-model fields for session source, connection state,
  fixture mode, stale snapshot status, reconnect attempts, and operator-facing
  messages.
- React top-bar badges for saved/live/API-unavailable source, connection state,
  fixture runs, and stale snapshots.
- View-model and React tests covering saved snapshots, live connected snapshots,
  fixture markings, and rendered source badges.

### Fixed

- React cockpit startup state now uses clean English text directly instead of
  correcting mojibake literals after initialization.
- Live SSE disconnects and API-unavailable refresh failures now update the main
  shared view model, not only the transient status line.

## [1.1.6] - 2026-06-07

1.1.6 adds the first real GUI cockpit end-to-end smoke gate.

### Added

- `npm run e2e:cockpit`, which starts the compiled `tedge client --no-open
  --port 0` entrypoint, opens the local cockpit URL, opens Chromium through
  Playwright, submits a fixture task, waits for approval state, opens the
  detail drawer, and checks responsive layouts at 1440, 1180, 768, and 390px.
- CI coverage for the cockpit e2e smoke on the Node 20 lane, including Chromium
  installation and failure artifact upload from `.tomorrowedge/e2e-artifacts`.
- Browser failure collection for console errors, page errors, failed requests,
  failing same-origin responses, screenshots, trace zips, and redacted server
  logs.

### Fixed

- React cockpit task titles now have stable truncation and tooltip behavior so
  long natural-language task names do not break the task list layout.
- React cockpit drawer, approval, composer, workflow, telemetry, and trace
  surfaces now expose stable `data-testid` selectors for E2E coverage.
- Several React cockpit labels were cleaned up from mojibake into plain English
  runtime text.

## [1.1.5] - 2026-06-07

1.1.5 is a GitHub issue-queue hardening release for the GUI client, local
cockpit API, packaging, desktop launcher, and CLI contract surface.

### Added

- React cockpit client wiring for sessions, ViewModel loading, run submission,
  live SSE updates, approval actions, and drawer state.
- Local cockpit serving for built `dist/cockpit-web` assets, with embedded HTML
  fallback when the build is unavailable.
- CLI contract coverage for `tedge mcp`, `tedge doctor --json`, invalid access
  mode errors, and common command help.
- README promise map documentation and docs-status checks.
- Desktop launcher lifecycle tests for fallback, cleanup, port fallback, and
  Electron child shutdown behavior.

### Fixed

- Browser approval API now rejects stale or mismatched approval IDs before
  applying patches or running shell commands.
- Artifact routes are restricted to recorded `artifacts/` refs.
- Live cockpit failure snapshots preserve accumulated events instead of
  replacing them with an empty state.
- Package zip generation no longer depends on a system `zip` binary and checks
  portable cockpit-web asset paths.
- `tedge benchmark` output now starts with a clear deterministic-demo warning.

## [1.1.4] - 2026-06-07

1.1.4 is a GUI/desktop branding hotfix.

### Fixed

- The GUI client top bar now uses the TomorrowEdge geometric mark instead of a
  generic letter tile.
- The local cockpit serves `/icon.svg` and `/manifest.webmanifest`, so browser
  tabs and desktop app-window launches no longer fall back to the default
  browser icon.

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
