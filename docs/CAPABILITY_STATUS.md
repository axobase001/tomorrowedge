# Capability Status

Authoritative status table for TomorrowEdge 1.2.11. Use this page when deciding
whether a surface is stable, experimental, placeholder, or planned.

| Capability | Status | Notes |
| --- | --- | --- |
| Offline fixture/mock workflow | stable | No API key required; covered by CI. |
| Access modes and full-access trace | stable | Restricted, partial, and full modes are implemented with event-ledger visibility. |
| Event ledger, artifacts, trace/export | stable | Sessions, events, artifact refs, markdown/json export, and trace diagnostics are implemented. |
| Adaptive planner and post-plan role routing | stable | The planner can use a routed model for structured plans with native adaptive fallback. Plans have variable task-specific steps, and high-risk or specialized planner output can trigger post-plan rerouting for downstream roles. |
| Strong-agent and per-role budget audit | stable | Routing emits `budget_preview` events without consuming budget, and invocation-time `budget_decision` events record allow/fallback/block outcomes. |
| Strong-agent and per-role budget enforcement | stable | Live and external role invocations pass through BudgetGate before execution. Blocked planner/reviewer/judge/coder roles use native fallback where available, and tests guard against blocked+success contradictions. |
| Workflow-kind trace completeness | stable | Read-only workflows use a read-only rubric and no longer require patch, review, judge, apply, or shell events. Patch workflows retain patch/review/judge/apply/shell requirements. |
| Workflow-kind role graph foundation | experimental | `RoleGraph` describes read-only, patch, debate patch, high-risk patch, and repair-loop role dependencies. The current native executor still executes mostly sequentially while consuming the graph for workflow classification and future scheduler hardening. |
| Provider configuration and OpenAI-compatible adapters | stable | OpenRouter, DeepSeek, MiMo, Kimi, Anthropic, Gemini, Ollama, mock, fixture, and generic OpenAI-compatible config are available. GUI setup and key management expose provider base URLs for compatible gateways. Real usability depends on provider keys, quota, endpoint region, and model support. |
| Provider smoke and connection checks | stable | `tedge models --provider`, `--connection-test`, `--real-smoke`, and `--smoke-suite` exist. Doctor reports static configuration, not guaranteed live chat quota. DeepSeek, MiMo, and generic OpenAI-compatible providers have known defaults, and older blank `base_url` configs are normalized at load time. |
| Live advisory and live patch candidates | experimental | Non-mutating live outputs are supported. Empty or malformed live patch diffs are rejected and retried before being marked unavailable. |
| Capability stitching for image inputs | experimental | Vision handoff and structured visual specs exist; provider-specific vision quality depends on configured model support. |
| MCP Agent Bridge | experimental | MCP server, tool surface, role binding, external agent registry, and command runner skeleton exist. Real Claude Code/Codex process integration still needs adapter hardening. |
| Local browser cockpit API | experimental | Local-first dashboard with nonce-protected API routes, approval ID validation, artifact-route confinement, and failed-live-run event preservation. Keep it bound to loopback unless you deliberately accept local-network exposure. |
| TomorrowEdge GUI Client | experimental | Browser GUI v1.2 uses the shared cockpit view model, live-event API, React cockpit build serving, runtime screenshots, collapsed telemetry summary, task queue, workflow main area, first-run provider/model setup wizard, top-bar English/Chinese language switching, composer-side access-mode dropdown, session-source/connection badges, approval-history timeline, capability dashboard, dark-mode CSS variables, branded favicon/manifest mark, the `tedge client` / `npm run client` entrypoint, and `npm run e2e:cockpit` coverage. |
| Optional desktop app window | experimental | `tedge desktop` / `npm run desktop` starts the same nonce-protected local cockpit in an app-window or optional Electron shell. The runtime core remains the local GUI client and event ledger. |
| Orchestration backend abstraction | placeholder | Native backend is real. LangGraph, CrewAI, AutoGen, and MCP tool backend entries are adapter placeholders. |
| Real Ink raw-mode TUI keyboard CI | stable | The Ink cockpit boots in a TTY-like raw-mode smoke test, accepts operator input, changes focus, and exits through Ctrl+Q in CI. |
| Strategy memory routing | experimental | Disabled by default. When explicitly enabled, recent completed workflows can recommend role routes and test commands. |
| Benchmark quality-cost-trace frontier | experimental | `tedge benchmark` provides a deterministic no-key product demo. It is not a live provider leaderboard claim. |
