# Image2 Reference To Implementation Mapping

| Image2 component | Reference file | Implemented component / surface |
|---|---|---|
| Top Bar | `docs/ui/image2-components/outputs/02-component-board-reference.png` | `src/cockpit-web/src/components/TopBar.tsx`, served fallback in `src/localCockpit/html.ts` |
| Task List Panel | `docs/ui/image2-components/outputs/02-component-board-reference.png` | `src/cockpit-web/src/components/TaskListPanel.tsx`, served fallback in `src/localCockpit/html.ts` |
| Workflow Spine / Main Workspace | `docs/ui/image2-components/outputs/01-four-zone-overview-reference.png`, `02-component-board-reference.png` | `src/cockpit-web/src/components/WorkflowPanel.tsx`, served fallback in `src/localCockpit/html.ts` |
| Approval / Diff Panel | `docs/ui/image2-components/outputs/03-approval-detail-reference.png` | `src/cockpit-web/src/components/ApprovalPanel.tsx`, approval state inside served fallback |
| Telemetry Summary Panel | `docs/ui/image2-components/outputs/01-four-zone-overview-reference.png`, `02-component-board-reference.png` | `src/cockpit-web/src/components/TelemetryPanel.tsx`, served fallback in `src/localCockpit/html.ts` |
| Natural Language Composer | `docs/ui/image2-components/outputs/01-four-zone-overview-reference.png`, `02-component-board-reference.png` | `src/cockpit-web/src/components/ComposerPanel.tsx`, served fallback in `src/localCockpit/html.ts` |
| Collapsed Bottom Log / Trace Sheet | `docs/ui/image2-components/outputs/03-approval-detail-reference.png` | `src/cockpit-web/src/components/BottomTraceSheet.tsx`, served fallback in `src/localCockpit/html.ts` |
| Drawer / Side Detail Panel | `docs/ui/image2-components/outputs/03-approval-detail-reference.png` | `src/cockpit-web/src/components/DetailDrawer.tsx`, detail drawer skeleton in served fallback |
| State Chips / Status Tokens | `docs/ui/image2-components/outputs/03-approval-detail-reference.png` | `src/cockpit-web/src/components/StatusChip.tsx`, `.chip` tokens in served fallback |
| Minimal Modal / Confirmation Dialog | `docs/ui/image2-components/outputs/03-approval-detail-reference.png` | `src/cockpit-web/src/components/ApprovalPanel.tsx`, approval intent endpoints in `src/localCockpit/server.ts` |

## Implementation Notes

The browser-served local cockpit remains dependency-light: the CLI can serve a
working GUI from the Node process even before a packaged Vite build exists. The
React/Vite source tree mirrors the same component boundaries so future compiled
bundles can replace the fallback surface without changing the cockpit contract.
