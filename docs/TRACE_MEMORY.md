# Objective-Action-Feedback Trace Memory

TomorrowEdge now writes an objective-action-feedback trace at the end of a
workflow. It is more compact and more reusable than the raw event ledger.

The raw event ledger remains the source of replay truth. The objective trace is
a learning record that summarizes:

- scenario profile
- Objective Contract and verification result
- plan and workflow kind
- role graph and routing decisions
- actions, tool calls, and observations
- evidence packets and missing evidence
- review / judge / verification outcome
- repair attempts
- cost and tool-call summary
- lessons for future runs

This lets TomorrowEdge retrieve similar prior runs without stuffing full logs,
diffs, and shell output back into a model prompt.

## CLI

```bash
tedge trace inspect latest
tedge trace inspect latest --json
tedge trace list --scenario debugging --limit 20
```

The trace list reads `.tomorrowedge/objective-traces.jsonl` in the current
project. Headless fixture runs also persist the compact trace back to the
project root, so `policy inspect` and `trace list` can reuse it.

