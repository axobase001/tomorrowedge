# Architecture

TomorrowEdge is split into stable contracts:

- `providers`: model adapters and offline fixtures
- `core/routing`: role-conditioned model assignment
- `core/model`: live provider calls, budget accounting, usage summaries, and fallback handling
- `core/events`: replayable full-access event ledger, artifact refs, trace rendering, and export support
- `core/agentGraph`: workflow execution state
- `core/agents`: Vision, Planner, Explorer, Coder, Reviewer, Judge, Repairer, Summarizer
- `core/capabilities`: capability stitching and structured handoffs
- `core/patch`: diff preview, validation, apply, undo
- `safety`: ignore rules, file risk, secret scanning, privacy guard
- `tui`: Ink panes for cockpit visibility
- `cli`: `tedge` commands

The default graph is offline and deterministic. Real model providers are optional and must be enabled explicitly.

Provider calls write `model_call:start`, `model_call:success`, and
`model_call:failure` events when an event ledger is attached. Provider fallback
is recorded as a first-class `provider_fallback` event, not only as a model note.

See [LIVE_EVENT_STREAM.md](LIVE_EVENT_STREAM.md) for the planned transition from
post-run ledger rendering to a live async event stream cockpit.
