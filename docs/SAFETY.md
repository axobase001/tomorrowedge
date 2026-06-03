# Safety

TomorrowEdge avoids hidden high-risk behavior:

- no telemetry by default
- no API keys in repo
- no cloud upload of ignored or secret-like files by default
- no shell execution without approval
- no patch application without approval
- no destructive operations by default
- no shell metacharacter execution or unsafe executable routing by default
- no artifact persistence without secret redaction
- no half-applied multi-file patch when a later write fails

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
Multi-file patch writes are transactional: if a later write fails, previously
written files in the same apply operation are restored or removed.

Shell safety validation blocks:

- shell metacharacters and command chaining
- dangerous executables such as delete, shutdown, downloader, and shell-spawn commands
- commands outside the safe verification allowlist

Approved shell commands are executed with direct executable invocation instead
of `shell: true`, so the command string is not passed through an interactive
shell.

Trace and artifact persistence redacts common secret formats and high-entropy
tokens before writing `.tomorrowedge/sessions/<session-id>/events.jsonl` or
artifact files.
