# Local Cockpit API

`tedge serve` starts a local-first browser cockpit for inspecting TomorrowEdge
sessions.

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
- `GET /api/sessions`
- `GET /api/sessions/latest`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/events`
- `GET /api/sessions/:id/artifacts/:ref`
- `POST /api/runs`
- `POST /api/mcp/register`

`POST /api/runs` defaults to fixture mode and does not approve patch or shell
actions unless the request explicitly sets approval flags.

## Why This Exists

The Ink terminal TUI remains useful for keyboard-driven workflows. The local
cockpit exists for visual inspection: it presents the same event ledger in a
denser, less ambiguous dashboard that matches the README runtime screenshot
style.
