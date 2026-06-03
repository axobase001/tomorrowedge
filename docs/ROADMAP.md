# Roadmap

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
  OpenAI-compatible, Kimi-compatible, and placeholder providers.
- Native Anthropic and Gemini adapters are either implemented or removed from
  user-facing recommended providers.
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
