# Roadmap

## 0.5.x Experience Polish / Cockpit Hardening

Acceptance criteria:

- README has a 3-minute no-key tryout path.
- TUI layout, screenshots, and docs present the same restrained cockpit style.
- Full/partial/restricted semantics and `shell.policy` are easy to understand.
- Trace/export quality makes fallback, repair, shell output, and artifact refs
  inspectable.
- MCP bridge status is explicit: Codex experimental, Claude Code wrapper
  required, mock stable, custom MCP experimental.

## 0.6.x Real External Agent Workflows

0.6.0 starts this track with the architecture base:

- Context projection separates full runtime artifacts from provider-visible
  previews.
- Evidence packets give reviewer/judge roles structured coding evidence.
- Routing, budget, fallback, projection, stop reason, and trace completeness
  diagnostics are recorded in the event ledger.
- External-agent invocation now has typed task/result envelope contracts.

Acceptance criteria:

- Codex CLI role runner has a documented, reproducible demo path.
- Claude Code wrapper path is documented with a local stdio MCP wrapper.
- External role normalize failures are visible in the event ledger before
  native fallback.
- External agent cost accounting is visible in TUI and exports.
- Role-bound execution demos cover planner, coder, reviewer, judge, and repairer.

## 0.7.x Benchmark Demo

Acceptance criteria:

- Public benchmark demo compares strong single-agent, cheap single-model, and
  TomorrowEdge multi-model cockpit workflows.
- Include at least one substantial migration or repair task such as C++ to Rust,
  state-machine generation, or UI reconstruction from screenshot.
- Report quality, cost, time, trace completeness, and repair visibility.
- Publish a hero figure that explains capability routing and auditability.

## 0.2 Usable CLI

Acceptance criteria:

- First-run config can be completed without overwriting user files.
- `tedge doctor` gives actionable provider/config fixes.
- Full/partial shell execution has hard safety boundaries.
- Events and artifacts are redacted by default.
- Context selection is task-relevant rather than alphabetical.
- Package metadata, CI smoke, and pack dry-run are release-ready.

## 0.3 Trusted Full Mode

Acceptance criteria:

- Command risk policy is configurable per repo/team.
- Verification supports a multi-step test plan.
- Cost budgets support per-run and daily caps.
- Undo/replay/export explain decisions, not only raw events.

## 0.4 Live TUI Workflow

Acceptance criteria:

- Executor emits live progress events.
- TUI updates while agents run.
- Patch/shell/repair approval loops are usable without leaving the TUI.
- Artifact navigation and rerun/undo are available inside the cockpit.

## 0.5 Provider Beta

Acceptance criteria:

- Provider smoke matrix covers OpenRouter, DeepSeek, MiMo, Ollama,
  OpenAI-compatible, Kimi-compatible, Anthropic, and Gemini providers.
- Native Anthropic and Gemini adapters have direct connection tests and unit
  coverage; real-key smoke coverage is expanded over time.
- Model routing explanations include capability, cost, privacy, fallback, and
  user override reasons.

## 1.0 Product Beta

Acceptance criteria:

- Team policy is supported.
- GitHub PR workflow can reuse TomorrowEdge reports.
- Strategy memory can influence routing under explicit user control.
- Plugin extension points are documented and stable.
- Product docs are split into Quickstart, Concepts, Config, Providers, Safety,
  TUI, Examples, Troubleshooting, and Release.
