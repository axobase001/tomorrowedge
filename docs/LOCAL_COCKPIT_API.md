# Local Cockpit API

`tedge serve` starts a local-first browser cockpit for inspecting TomorrowEdge
sessions. When the React cockpit bundle exists at `dist/cockpit-web`, the
server uses it as the primary GUI client. The embedded HTML string in
`src/localCockpit/html.ts` is a fallback for source checkouts or installs that
do not have the web bundle available.

```bash
npm run dev -- serve --open
```

Default URL:

```text
http://127.0.0.1:18792
```

## Security Boundary

The local cockpit is designed for local-first inspection and control. By
default it binds to `127.0.0.1` and prints a per-process nonce URL. Every
`/api/*` request must include that nonce through the generated URL, the
`x-tomorrowedge-token` header, or a bearer value.

Mutating browser requests also validate `Origin` against the current `Host`.
Requests without an `Origin` header are allowed so local CLI scripts can still
call the API deliberately. If you bind with `--host 0.0.0.0` or another
non-loopback address, treat the nonce URL as a local admin credential and avoid
using full mode on shared networks.

The browser cockpit is a readable session inspector, not a general chat gateway.
It keeps TomorrowEdge's product boundary focused on coding workflows: routing,
agents, patch candidates, evidence packets, review, judge, shell output, and
trace diagnostics.

## Endpoints

- `GET /health`
- `GET /` / `GET /cockpit` serves the React cockpit build when available, or
  the embedded fallback client otherwise.
- `GET /assets/*` serves static files from the built React cockpit only.
- `GET /api/sessions`
- `GET /api/sessions/latest`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/view-model`
- `GET /api/sessions/:id/events`
- `GET /api/sessions/:id/artifacts/:ref`
- `GET /api/runs/:id/events/live`
- `POST /api/runs`
- `POST /api/approvals`
- `POST /api/mcp/register`

`GET /api/sessions/:id/artifacts/:ref` serves only recorded artifact refs under
the `artifacts/` prefix. Traversal, absolute paths, and non-artifact session
files are rejected.

`POST /api/runs` defaults to fixture mode and does not approve patch or shell
actions unless the request explicitly sets approval flags. If `accessMode` is
provided, it must be one of `restricted`, `partial`, or `full`; invalid values
are rejected instead of silently falling back to project defaults.

`GET /api/sessions/:id/view-model` returns the shared cockpit ViewModel used by
browser GUI surfaces. It includes task summaries, workflow spine state,
telemetry, current approval, drawer details, route summaries, and trace items.

`GET /api/runs/:id/events/live` streams server-sent events for an in-progress
run. The stream emits a `ready` event first, then `event` messages for live
ledger updates and `snapshot` messages with the current state plus ViewModel.
When a snapshot is marked done, clients should close the stream and refresh the
persisted session ViewModel.

`POST /api/approvals` executes browser approval actions through the Node
cockpit runtime. Supported actions are:

- `approve_patch`
- `reject_patch`
- `approve_shell`
- `reject_shell`
- `request_re_review`
- `undo_latest_patch`

Patch and shell approval actions require the active `approvalId` returned by the
ViewModel. Stale or mismatched approval IDs are rejected before any patch is
applied or shell command is run.

`POST /api/mcp/register` requires an active `sessionId` so external-agent
registration is recorded in a specific session ledger. The endpoint validates
the session before registering the profile.

## Why This Exists

The Ink terminal TUI remains useful for keyboard-driven workflows. The local
cockpit exists for visual inspection: it presents the same event ledger in a
denser, less ambiguous dashboard that matches the README runtime screenshot
style.
