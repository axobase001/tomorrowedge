# Capability Status

Authoritative status table for TomorrowEdge 1.0.0. Use this page when deciding
whether a surface is stable, experimental, placeholder, or planned.

| Capability | Status | Notes |
| --- | --- | --- |
| Offline fixture/mock workflow | stable | No API key required; covered by CI. |
| Access modes and full-access trace | stable | Restricted, partial, and full modes are implemented with event-ledger visibility. |
| Event ledger, artifacts, trace/export | stable | Sessions, events, artifact refs, markdown/json export, and trace diagnostics are implemented. |
| Provider configuration and OpenAI-compatible adapters | stable | OpenRouter, DeepSeek, MiMo, Kimi, Anthropic, Gemini, Ollama, mock, fixture, and generic OpenAI-compatible config are available. Real usability depends on provider keys, quota, and model support. |
| Provider smoke and connection checks | stable | `tedge models --provider`, `--connection-test`, `--real-smoke`, and `--smoke-suite` exist. Doctor reports static configuration, not guaranteed live chat quota. |
| Live advisory and live patch candidates | experimental | Non-mutating live outputs are supported. Empty or malformed live patch diffs are rejected and retried before being marked unavailable. |
| Capability stitching for image inputs | experimental | Vision handoff and structured visual specs exist; provider-specific vision quality depends on configured model support. |
| MCP Agent Bridge | experimental | MCP server, tool surface, role binding, external agent registry, and command runner skeleton exist. Real Claude Code/Codex process integration still needs adapter hardening. |
| Local browser cockpit API | experimental | Local-first dashboard with nonce-protected API routes. Keep it bound to loopback unless you deliberately accept local-network exposure. |
| Orchestration backend abstraction | placeholder | Native backend is real. LangGraph, CrewAI, AutoGen, and MCP tool backend entries are adapter placeholders. |
| Real Ink raw-mode TUI keyboard CI | planned | Static/non-raw and extracted action tests exist; PTY/raw-mode keyboard coverage is tracked separately. |
| Benchmark quality-cost-trace frontier | planned | Benchmark scaffolding exists, but public comparative benchmark claims are not yet established. |
