# Safety

TomorrowEdge avoids hidden high-risk behavior:

- no telemetry by default
- no API keys in repo
- no cloud upload of ignored or secret-like files by default
- no shell execution without approval
- no patch application without approval
- no destructive operations by default

Access modes:

- `restricted`: blocks cloud/model calls, patch application, shell commands, and repair writes
- `partial`: allows model calls, but patch/shell/repair actions require explicit approval
- `full`: autonomous execution with complete workspace tool access; patch/shell/repair actions are auto-approved and recorded in the event ledger

Use `tedge mode <mode>` to persist a mode in `.tomorrowedge/config.yaml`, or
`tedge run ... --access-mode <mode>` for a single run.

Full mode is not partial mode with extra confirmations. It is the high-autonomy
mode. The safety boundary is visibility and bounded execution: every model call,
context selection, patch, command, review, judge decision, fallback, cost update,
and verification result is logged to `.tomorrowedge/sessions/<session-id>/events.jsonl`.

Patch safety validation blocks:

- paths that escape the project root
- ignored files and built-in excluded paths
- sensitive targets such as `.env`, key files, local databases, and credential-like paths

Undo snapshots are stored under `.tomorrowedge/undo/` before patch writes.
