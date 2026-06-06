# Four-Zone Quiet Cockpit Image2 Selection

TomorrowEdge 1.1.0 uses an image2-first GUI refactor flow. The generated
references are intentionally treated as visual specifications rather than
decorative mockups.

## Selected References

| Reference | Role | Decision |
|---|---|---|
| `outputs/01-four-zone-overview-reference.png` | Whole-screen layout | Adopt the fixed four-zone layout, low composer height, central workflow spine, and right telemetry tables. |
| `outputs/02-component-board-reference.png` | Top bar, task list, workflow, telemetry, composer | Adopt compact row density, pale blue active states, thin borders, and the non-chat composer. |
| `outputs/03-approval-detail-reference.png` | Approval, trace sheet, drawer, chips, modal | Adopt central diff approval, bottom trace strip, drawer detail structure, chip palette, and minimal confirmation dialogs. |

## Visual Decisions

- Default surface is Light / Ice White. Dark mode remains future work.
- The central workflow spine owns the main focus. Telemetry and tasks are
  supporting panels, not competing dashboards.
- The natural-language area is a command composer. It remains short and
  control-oriented, with no chat bubble stream.
- Approval state switches the main workspace to a diff-oriented surface with
  clear `批准`, `拒绝`, and `再看` actions.
- Cards use low radius and thin borders; no glassmorphism, no cyberpunk, no
  SaaS dashboard decoration.

## Deviations

- The generated references contain a few misspelled or inconsistent model names.
  Implementation uses accurate TomorrowEdge labels and data from the shared
  cockpit view model.
- Some generated icons are replaced by simple text or native button labels for
  accessibility and deterministic rendering.
