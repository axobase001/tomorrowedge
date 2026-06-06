# GUI v1.1 Component Review

Each v1.1 reference board contains three visual variants. The implementation
selects the quietest and least admin-dashboard-like elements from those boards.

| Component | Reference board | Selected direction | Implement |
|---|---|---|---|
| Telemetry Collapsed Summary | `04-telemetry-collapsed-v11.png` | Variant A: stacked summary metrics with weak `details >` | Replace default right-side tables with metric rows. |
| Lighter Workflow Spine | `05-workflow-spine-light-v11.png` | Variant B/C: muted completed steps, expanded current step | Reduce card feel and keep only current stage expanded. |
| Reduced-Border Task Queue | `06-task-list-reduced-v11.png` | Variant B/C: queue rows with tiny state markers | Hide IDs/roles by default and lower row height. |
| Quiet Command Composer | `07-command-composer-quiet-v11.png` | Variant C: one-line command surface with chips | Shrink composer and make controls secondary. |
| Simplified Top Bar | `08-topbar-simplified-v11.png` | Variant B: local tool strip with essentials only | Remove cost/token/cache from top bar, keep mode/session/run/settings. |
| Approval Main Workspace | `09-approval-main-workspace-v11.png` | Variant B/C: approval summary first, full diff hidden | Main view shows stats and CTA; full diff lives in drawer. |
| Whole Screen | `10-fullscreen-v11-variants.png` | Variant B: four-zone but quiet | Use as final balance check. |

Elements intentionally not implemented:

- dense full telemetry tables in the default state
- full diff wall as the default approval view
- heavy CRM/ticket card borders in the task queue
- permanent slash-command shortcut list in the composer
- topbar metrics that compete with the workflow focus
