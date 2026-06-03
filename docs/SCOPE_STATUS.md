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
- Capability stitching route for image inputs: Vision Agent -> Structured Visual Spec -> Planner/Coder/Reviewer
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
- Learned task memory stored as compact `.tomorrowedge/task-memory.jsonl`
- Multi-model non-mutating capability drill with local planner/reviewer rubric
- Core-led workflow simulation with task decomposition, multi-round model debate, role execution, Core review, budget preflight, and saved report
- `tedge run --image <path>` image/screenshot/diagram handoff with structured visual spec in session output
- `tedge review-export latest --format github|google-docs` local review/comment draft export
- Ink TUI panes, command palette, access/model panels, and interactive `a`, `t`, `u`, `c`, `p`, `m`, `q` controls
- Safety basics: ignore rules, file risk, secret scanner, privacy guard
- Image2 UI baseline with Chinese default and subtle sci-fi style
- Offline unit/integration tests
- Realistic benchmark fixtures for JavaScript, Python, TypeScript, React UI, and state-machine/diagram tasks
- Release dry-run packaging scripts, release checklist, and GitHub Actions CI

## Partially Implemented

- Real provider adapters: OpenRouter, DeepSeek, and MiMo Token Plan live smoke and drill pass; Anthropic/Gemini are placeholders
- Debate mode: deterministic records and core-led live workflow debate with configurable cross-examination rounds exist; richer free-form negotiation UI is not complete
- Routing: role assignment uses enabled providers, live-call fallback, capability tags, and smoke-suite probing; richer adaptive routing still needs longitudinal evaluation
- Capability stitching: offline structured visual spec, routing handoff, and live multimodal image payload path exist; provider-specific vision behavior still needs real smoke coverage per model
- Privacy mode: cloud repo context is enforced for live patch prompts; broader provider operations still need full audit
- TUI: panes, focus navigation, command/access/model panels, and temporary model-route preview exist; richer editing modal persistence is not complete
- Verification: test runner, repair loop, and evidence matcher exist but are still minimal
- Memory: session memory, project preferences, and compact learned task memory exist; deeper cross-session strategy learning is still minimal

## Not Yet Implemented

- External Google/GitHub comment publishing connectors beyond local draft export
- Provider-specific live vision smoke assertions across every configured model
- Persistent TUI model-change modal that writes config/preferences
- Deeper learned memory that recommends routes based on historical outcomes
- Public release publishing automation beyond CI and pack dry-run
