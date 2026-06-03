# Architecture

TomorrowEdge is split into stable contracts:

- `providers`: model adapters and offline fixtures
- `core/routing`: role-conditioned model assignment
- `core/model`: live provider calls, budget accounting, usage summaries, and fallback handling
- `core/agentGraph`: workflow execution state
- `core/agents`: Vision, Planner, Explorer, Coder, Reviewer, Judge, Repairer, Summarizer
- `core/capabilities`: capability stitching and structured handoffs
- `core/patch`: diff preview, validation, apply, undo
- `safety`: ignore rules, file risk, secret scanning, privacy guard
- `tui`: Ink panes for cockpit visibility
- `cli`: `tedge` commands

The default graph is offline and deterministic. Real model providers are optional and must be enabled explicitly.
