# TomorrowEdge GUI Design System

This is the browser cockpit design authority. Read this file before changing
`src/cockpit-web`, `src/localCockpit/html.ts`, or GUI screenshots.

## Product Register

TomorrowEdge is a quiet local coding cockpit for supervising workflow runs,
approvals, costs, evidence, and trace state. It is not a chat history, SaaS
dashboard, marketing page, or cloud-console resource table.

Default browser GUI language is English (`en`) with a Chinese (`zh`) selector in
the React cockpit. The embedded fallback cockpit is English-only and must declare
`<html lang="en">` until it gets the same i18n runtime.

## Token Roles

React cockpit tokens live in `src/cockpit-web/src/theme/tokens.css`. The fallback
client keeps inline tokens in `src/localCockpit/html.ts`, mapped as follows:

| Role | React token | Fallback token | Light value |
| --- | --- | --- | --- |
| Page background | `--te-bg` | `--bg` | `#f6fafc` |
| Surface | `--te-surface` | `--surface` | `#ffffff` |
| Alternate surface | `--te-alt` | `--alt` | `#eef5f8` |
| Border | `--te-border` | `--border` | `#d7e4ea` |
| Strong border | `--te-border-strong` | `--border-strong` | `#b8cbd5` |
| Primary text | `--te-text` | `--text` | `#17212b` |
| Muted text | `--te-muted` | `--muted` | `#6b7a88` |
| Primary blue | `--te-blue` | `--blue` | `#6fafd2` |
| Deep blue | `--te-deep-blue` | `--deep-blue` | `#2f6f92` |
| Success | `--te-success` | `--success` | `#2f9d68` |
| Warning | `--te-warning` | `--warning` | `#b7791f` |
| Danger | `--te-danger` | `--danger` | `#c94a4a` |

Both surfaces must keep dark-mode tokens, `focus-visible` rings, and
`prefers-reduced-motion` handling.

## Component Contracts

- Top bar: brand, workspace, mode/session chips, language or fallback status,
  key management, run action, stop action while running, refresh.
- Task queue: saved sessions, current task, rename/delete controls in React,
  empty state.
- Workflow spine: Plan, Route, Edit, Review, Test, Judge, Approve with pending,
  running, waiting, done, and failed states.
- Approval card: summary-first risk/test/file metadata, approve/reject/review
  controls, drawer path for details.
- Telemetry: cost, budget, tokens, route summary, strong-call count, receipt
  action, drawer action.
- Detail drawer: approval history, objective contract/trace, governance, memory,
  error-loop timeline, role graph, task graph, artifacts, raw events.
- Composer: task input, access mode, run mode, target, run settings, full
  autonomy preflight, disabled/empty/error states, stop action while running.
- Setup/key manager overlays: modal semantics, focus trap, provider/model/key
  controls, validation, loading and error states.

## Required States

Every interactive GUI control must define default, hover, active, focus-visible,
disabled, loading, empty, error, success, waiting-approval, running, and
disconnected behavior where the state can occur. If a fallback surface differs,
the difference must be documented in
`docs/ui/gui-v1.1/implementation_deviation.md`.

## Motion

Motion is functional only: loading spinners, drawer/modal transitions, and state
changes that help orientation. `prefers-reduced-motion: reduce` must disable or
near-disable animations and transitions.

## Don'ts

- No purple cyberpunk, neon, glassmorphism, decorative gradients, or card walls.
- No chat-bubble history as the main workflow surface.
- No marketing hero composition in the local cockpit.
- No hover-only critical state. Critical run, approval, cost, and autonomy state
  must be visible without hovering.
