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
