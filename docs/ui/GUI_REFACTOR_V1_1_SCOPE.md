# TomorrowEdge GUI Refactor v1.1 Scope

Goal: keep the Four-Zone Cockpit structure, but reduce the current admin-dashboard
feel into a Codex-like quiet local coding-agent cockpit.

## Required Direction

TomorrowEdge GUI should feel like a quiet local coding-agent cockpit, not an
admin dashboard.

Retain:

- simplified top bar
- reduced-border task queue
- lighter workflow main area
- collapsed telemetry summary
- short command composer

Refine:

- telemetry defaults to summary metrics, not full tables
- workflow stages become a light progress spine, not approval cards
- task items become quiet queue rows, not CRM/work-order cards
- command composer becomes low-height and command-oriented
- approval state becomes the only central focus, with full diff in drawer/expand

## Image2-First Requirements

The v1.1 refinement continues the image2-first flow. The following component
reference boards are required and saved under
`docs/ui/image2-components/outputs/`:

- `04-telemetry-collapsed-v11.png`
- `05-workflow-spine-light-v11.png`
- `06-task-list-reduced-v11.png`
- `07-command-composer-quiet-v11.png`
- `08-topbar-simplified-v11.png`
- `09-approval-main-workspace-v11.png`
- `10-fullscreen-v11-variants.png`

Every obvious implementation deviation must be recorded in
`docs/ui/gui-v1.1/implementation_deviation.md`.

## Acceptance

- Four-zone structure is preserved.
- Center workflow remains the visual focus.
- Right panel defaults to collapsed summary rather than full tables.
- Left panel reads as a task queue rather than a ticket system.
- Bottom region reads as command composer rather than chat or admin form.
- Waiting approval makes the central approval workspace the single focus.
- `npm test` and `npm run build` pass.
