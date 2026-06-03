# Scope Status

This file tracks the full-scope request against the current implementation.

## Implemented

- Clean-room note and project docs
- TypeScript CLI/TUI scaffold
- `tedge init`, `tui`, `run`, `config`, `models`, `doctor`, `replay`, `sessions`, `undo`
- Offline `mock` and `fixture` providers
- Config loader with safe defaults and Chinese UI language default
- Local `.env` loader for ignored workspace credentials
- Provider registry with OpenAI-compatible, OpenRouter, MiMo, DeepSeek, Kimi, Anthropic/Gemini placeholders, and Ollama
- Role-conditioned routing modes that include enabled real providers
- Dynamic live-call fallback from unavailable routed providers to offline mock fallback, recorded in `modelNotes`
- `tedge models --real-smoke` live connectivity check
- `--live-advisory` non-mutating real-provider notes for planner/coder/reviewer/judge
- `--live-patch` real-provider patch candidate generation without automatic application
- Access modes: `restricted`, `partial`, `full`, with persistent `tedge mode`
- Live token accounting and optional USD estimates from configurable per-million-token prices
- Budget preflight for live advisory and live patch workflows when provider prices are configured
- Offline agent graph: Planner, Explorer, Coder-A/B, Reviewer, Judge, Runner, Summarizer
- Deterministic Repairer loop after failed approved fixture tests
- Red-team review mode with adversarial findings in review output
- Fixture debate flow with candidate selection and deterministic multi-round debate records
- Patch preview, safety validation, explicit approval, apply, undo snapshot, latest undo restore
- Create/delete patch support in the patch parser and applier
- Rename and binary patch detection with explicit safety blocking
- Shell command execution only after explicit approval
- Session memory, session listing, and replay latest
- Project preferences stored in `.tomorrowedge/preferences.json`
- Multi-model non-mutating capability drill with local planner/reviewer rubric
- Core-led workflow simulation with task decomposition, multi-round model debate, role execution, Core review, budget preflight, and saved report
- Ink TUI panes, command palette, access/model panels, and interactive `a`, `t`, `u`, `c`, `p`, `m`, `q` controls
- Safety basics: ignore rules, file risk, secret scanner, privacy guard
- Image2 UI baseline with Chinese default and subtle sci-fi style
- Offline unit/integration tests
- Release dry-run packaging scripts and release checklist

## Partially Implemented

- Real provider adapters: OpenRouter, DeepSeek, and MiMo Token Plan live smoke and drill pass; Anthropic/Gemini are placeholders
- Debate mode: deterministic records and core-led live workflow debate with configurable cross-examination rounds exist; richer free-form negotiation UI is not complete
- Routing: role assignment uses enabled providers and live-call fallback exists; richer capability probing is still shallow
- Privacy mode: cloud repo context is enforced for live patch prompts; broader provider operations still need full audit
- TUI: panes and lightweight command/access/model panels exist; pane focus and richer keyboard navigation are not complete
- Verification: test runner, repair loop, and evidence matcher exist but are still minimal
- Memory: session memory and project preferences exist; deeper task-learning is still minimal

## Not Yet Implemented

- Google-style or GitHub-style review/comment integrations
- Additional realistic benchmark tasks beyond tiny JavaScript/Python/TypeScript fixtures
- Real provider smoke suite with richer assertions and graceful CI skip per provider
- TUI pane focus and fully interactive model-change modal
- Rich learned task memory beyond explicit project preferences
- Public release hardening and publishing automation
