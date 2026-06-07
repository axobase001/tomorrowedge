# README Promise Map

Authoritative map for TomorrowEdge 1.1.4 README product promises. Use this
file when strengthening README language: every user-visible promise should have
an implementation owner plus either a validation command or a tracking issue.

## GUI Client

| Promise id | README promise | Implementation owner | Current validation | Tracking |
| --- | --- | --- | --- | --- |
| gui-entrypoint | `tedge client` / `npm run client` opens the local GUI client. | `src/cli/index.ts`, `src/cli/commands/serve.ts`, `src/localCockpit/server.ts` | `tests/unit/localCockpit.test.ts`, `npm run smoke:cli` | #140, #142 |
| task-queue | The GUI shows task queue / current task / recent sessions. | `src/cockpit/viewModel.ts`, `src/localCockpit/html.ts`, `src/cockpit-web/src/components/TaskListPanel.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #134, #145 |
| workflow-main | The center workspace shows Plan, Route, Edit, Review, Test, Judge, Approve state. | `src/cockpit/viewModel.ts`, `src/cockpit-web/src/components/WorkflowPanel.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #145, #146 |
| approval-actions | Browser approval buttons send intents; Node applies patch/shell actions. | `src/cockpit/approvalExecutor.ts`, `src/localCockpit/server.ts`, `src/cockpit-web/src/components/ApprovalPanel.tsx` | `tests/unit/localCockpit.test.ts`, `tests/integration/tuiApprovalActions.test.ts` | #137, #147, #150 |
| telemetry-summary | The GUI exposes provider, cost, token, agent, risk, and fallback summaries. | `src/cockpit/viewModel.ts`, `src/cockpit-web/src/components/TelemetryPanel.tsx`, `src/localCockpit/html.ts` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #152 |
| detail-drawer | Details drawer surfaces route, artifact, and workflow details without duplicating the main view. | `src/cockpit-web/src/components/DetailDrawer.tsx`, `src/localCockpit/html.ts` | `tests/unit/cockpitWeb.test.ts` | #134 |
| trace-strip | The GUI shows recent event ledger state and live updates. | `src/cockpit/viewModel.ts`, `src/cockpit/eventBus.ts`, `src/localCockpit/server.ts`, `src/cockpit-web/src/components/BottomTraceSheet.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/localCockpit.test.ts` | #138 |
| command-composer | Natural-language command composer starts runs and preserves IME-safe Enter behavior. | `src/localCockpit/html.ts`, `src/cockpit-web/src/components/ComposerPanel.tsx` | `tests/unit/localCockpit.test.ts`, `tests/unit/cockpitWeb.test.ts` | #134 |
| runtime-screenshots | README GUI screenshots are runtime states rather than static reference boards. | `docs/ui/screenshots/gui-v1.1`, `src/localCockpit/html.ts`, `src/cockpit-web` | Local Playwright screenshot smoke from PR validation; screenshot automation still needs a stable CI hook. | #154 |

## Desktop Entrypoint

| Promise id | README promise | Implementation owner | Current validation | Tracking |
| --- | --- | --- | --- | --- |
| desktop-entrypoint | `tedge desktop` opens the same local cockpit in an app window or browser fallback. | `src/cli/commands/desktop.ts`, `desktop/electron-main.cjs`, `src/localCockpit/server.ts` | CLI smoke covers command discovery; launcher behavior needs focused unit tests. | #155, #156 |
| desktop-lifecycle | Closing an Electron desktop window stops the local cockpit server. | `src/cli/commands/desktop.ts`, `desktop/electron-main.cjs` | No focused automated coverage yet. | #157 |
| desktop-port-fallback | Desktop mode falls forward when the requested port is occupied. | `src/cli/commands/desktop.ts`, `src/localCockpit/server.ts` | `tests/unit/localCockpit.test.ts` covers the server; desktop command output/launch URL need coverage. | #158 |

## Package And Release

| Promise id | README promise | Implementation owner | Current validation | Tracking |
| --- | --- | --- | --- | --- |
| react-primary-client | Packaged `tedge client` should serve the React cockpit build when available and fallback only when missing. | `src/localCockpit/server.ts`, `src/cockpit-web`, `package.json` | `npm run web:build`; package install smoke still pending. | #140, #141, #159 |
| package-assets | The npm package should include `dist/cockpit-web/index.html` and built assets. | `package.json`, `src/cockpit-web/vite.config.ts`, release scripts | `npm pack --dry-run` is currently manual output unless a smoke script parses it. | #160 |
| zip-assets | The zip package should include the same cockpit build with portable archive paths. | `scripts/package-zip.ts`, `package.json` | `tests/unit/releaseScripts.test.ts` covers zip mechanics; cockpit asset assertions still pending. | #161 |

## Editing Rule

If README wording adds or strengthens a GUI, desktop, or release-package
promise, update this map in the same PR. If the promise is not implemented or
not tested yet, link a GitHub issue instead of leaving the claim unowned.
