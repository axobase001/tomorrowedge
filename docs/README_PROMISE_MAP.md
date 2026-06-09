# README Promise Map

Authoritative map for TomorrowEdge 1.2.14 README product promises. Use this
file when strengthening README language: every user-visible promise should have
an implementation owner plus either a validation command or a tracking issue.

## GUI Client

| Promise id | README promise | Implementation owner | Current validation | Tracking |
| --- | --- | --- | --- | --- |
| gui-entrypoint | `tedge client` / `npm run client` opens the local GUI client. | `src/cli/index.ts`, `src/cli/commands/serve.ts`, `src/localCockpit/server.ts` | `tests/unit/localCockpit.test.ts`, `npm run smoke:cli` | #140, #142 |
| task-queue | The GUI shows task queue / current task / recent sessions. | `src/cockpit/viewModel.ts`, `src/localCockpit/html.ts`, `src/cockpit-web/src/components/TaskListPanel.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #134, #145 |
| session-source | The GUI labels live sessions, saved snapshots, fixture demos, API-unavailable states, and connection status. | `src/cockpit/contracts.ts`, `src/cockpit/viewModel.ts`, `src/localCockpit/server.ts`, `src/cockpit-web/src/main.tsx`, `src/cockpit-web/src/components/TopBar.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts`, `tests/unit/localCockpit.test.ts` | #165, #166, #167, #168, #169, #170 |
| gui-language | The GUI defaults to English and can switch to Chinese from the top bar with a locally persisted preference. | `src/cockpit-web/src/i18n.ts`, `src/cockpit-web/src/main.tsx`, `src/cockpit-web/src/components/TopBar.tsx` | `tests/unit/cockpitWeb.test.ts`, `npm run e2e:cockpit` | #294 |
| capability-dashboard | Detail drawer shows product capability readiness for workflow ledger, provider routing/model availability, evidence/budget/cost telemetry, MCP external agents, orchestration adapters, and GUI client status. | `src/cockpit/capabilityRegistry.ts`, `src/cockpit/viewModel.ts`, `src/cockpit-web/src/components/DetailDrawer.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #186, #187, #188, #189, #190, #191 |
| workflow-main | The center workspace shows Plan, Route, Edit, Review, Test, Judge, Approve state. | `src/cockpit/viewModel.ts`, `src/cockpit-web/src/components/WorkflowPanel.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #145, #146 |
| approval-actions | Browser approval buttons send intents; Node applies patch/shell actions. | `src/cockpit/approvalExecutor.ts`, `src/localCockpit/server.ts`, `src/cockpit-web/src/components/ApprovalPanel.tsx` | `tests/unit/localCockpit.test.ts`, `tests/integration/tuiApprovalActions.test.ts` | #137, #147, #150 |
| approval-history | Detail drawer shows a chronological approval timeline with approvalId, actor/source, blocking reason, diff/output refs, undo snapshot metadata, and filter tags. | `src/cockpit/contracts.ts`, `src/cockpit/viewModel.ts`, `src/cockpit-web/src/components/DetailDrawer.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #171, #172, #173, #174, #175, #176, #177, #178 |
| telemetry-summary | The GUI exposes provider, cost, token, agent, risk, and fallback summaries. | `src/cockpit/viewModel.ts`, `src/cockpit-web/src/components/TelemetryPanel.tsx`, `src/localCockpit/html.ts` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/cockpitWeb.test.ts` | #152 |
| detail-drawer | Details drawer surfaces route, artifact, and workflow details without duplicating the main view. | `src/cockpit-web/src/components/DetailDrawer.tsx`, `src/localCockpit/html.ts` | `tests/unit/cockpitWeb.test.ts` | #134 |
| trace-strip | The GUI shows recent event ledger state and live updates. | `src/cockpit/viewModel.ts`, `src/cockpit/eventBus.ts`, `src/localCockpit/server.ts`, `src/cockpit-web/src/components/BottomTraceSheet.tsx` | `tests/unit/cockpitViewModel.test.ts`, `tests/unit/localCockpit.test.ts` | #138 |
| command-composer | Natural-language command composer starts runs and preserves IME-safe Enter behavior. | `src/localCockpit/html.ts`, `src/cockpit-web/src/components/ComposerPanel.tsx` | `tests/unit/localCockpit.test.ts`, `tests/unit/cockpitWeb.test.ts` | #134 |
| runtime-screenshots | README GUI screenshots are runtime states rather than static reference boards. | `docs/ui/screenshots/gui-v1.1`, `src/localCockpit/html.ts`, `src/cockpit-web` | `npm run e2e:cockpit` captures failure screenshots/traces and validates the runtime GUI path in CI. | #154, #179, #185 |
| responsive-theme | React and fallback HTML cockpits support OS dark mode and avoid hard fallback min-width locks. | `src/cockpit-web/src/theme/tokens.css`, `src/localCockpit/html.ts` | `tests/unit/cockpitWeb.test.ts`, `npm run e2e:cockpit` | #249, #251, #253, #255 |
| first-run-setup | First GUI launch can configure one provider/model through env-var indirection and encrypted `.tomorrowedge/secrets.enc` storage, while legacy `.tomorrowedge/local.env` remains readable. | `src/localCockpit/setup.ts`, `src/localCockpit/server.ts`, `src/cockpit-web/src/components/SetupWizard.tsx`, `src/core/secrets/secretManager.ts` | `tests/unit/localCockpit.test.ts`, `tests/unit/secretManager.test.ts`, `tests/unit/cockpitWeb.test.ts`, `npm run e2e:cockpit` | implemented |
| deepseek-readiness | DeepSeek GUI key-manager setup remains testable after saving only key, env name, and model because the known endpoint is supplied even for older blank configs. | `src/config/defaultConfig.ts`, `src/config/configLoader.ts`, `src/localCockpit/setup.ts` | `tests/unit/config.test.ts`, `tests/unit/localCockpit.test.ts`, `tedge models --connection-test --provider deepseek` | implemented |
| compatible-base-url | GUI setup and key management can persist provider base URLs for MiMo, generic OpenAI-compatible gateways, and custom compatible endpoints. | `src/config/defaultConfig.ts`, `src/config/configLoader.ts`, `src/localCockpit/setup.ts`, `src/localCockpit/server.ts`, `src/cockpit-web/src/components/SetupWizard.tsx`, `src/cockpit-web/src/components/KeyRoleManager.tsx` | `tests/unit/config.test.ts`, `tests/unit/localCockpit.test.ts`, `tests/unit/cockpitWeb.test.ts` | implemented |
| composer-access-mode | The natural-language composer exposes `restricted`, `partial`, and `full` mode selection beside the input before task submission. | `src/cockpit-web/src/components/ComposerPanel.tsx`, `src/cockpit-web/src/main.tsx`, `src/localCockpit/server.ts` | `tests/unit/cockpitWeb.test.ts`, `tests/unit/localCockpit.test.ts` | implemented |
| orchestration-governance | README positions TomorrowEdge as a GUI orchestration layer for strong-agent governance, budget-constrained routing, and multi-agent coding workflows. | `src/core/goal/modelPlanner.ts`, `src/core/goal/workflowIntent.ts`, `src/core/routing/policies.ts`, `src/core/routing/router.ts`, `src/core/budget/budgetAllocator.ts`, `src/core/budget/budgetGate.ts`, `src/core/orchestration/roleGraph.ts`, `src/core/diagnostics/traceCompleteness.ts`, `src/config/schema.ts` | `tests/unit/plannerPolicy.test.ts`, `tests/unit/budgetGate.test.ts`, `tests/integration/governedWorkflow.test.ts`, `tests/unit/workflowIntentRouting.test.ts`, `tests/unit/roleGraph.test.ts`, `tests/unit/agentGraph.test.ts` | #296, #297, #298, #299, #323 |
| workflow-recipes | Built-in coding workflow recipes provide review-only, bugfix-sprint, and security-audit starting points without becoming a general personal-agent skill system. | `src/core/recipes/recipeLoader.ts`, `src/cli/commands/recipes.ts`, `src/cli/commands/run.ts` | `tests/unit/recipes.test.ts`, `tests/unit/agentGraph.test.ts` | #314 |
| route-reasons | GUI detail drawer route rows include role, provider/model, and routing reason. | `src/cockpit-web/src/components/DetailDrawer.tsx` | `tests/unit/cockpitWeb.test.ts` | #318 |
| repair-approval-focus | Failed verification repair candidates remain visible as repair approval cards and browser approval applies the repair candidate. | `src/cockpit/viewModel.ts`, `src/cockpit/approvalExecutor.ts` | `tests/unit/cockpitViewModel.test.ts` | #320 |
| external-mcp-process-reuse | Auto-started external MCP process clients are reused during role calls and released after workflow finalization. | `src/core/externalAgents/externalRoleInvoker.ts`, `src/core/externalAgents/externalAgentProcess.ts`, `src/core/agentGraph/executor.ts` | `tests/unit/externalAgentRunner.test.ts`, `tests/unit/agentGraph.test.ts` | #311 |
| workflow-simulation-native | `tedge workflow` is a NativeBackend dry-run projection rather than a second orchestration engine. | `src/core/eval/workflowSimulation.ts`, `src/core/agentGraph/executor.ts`, `src/core/externalAgents/externalRoleInvoker.ts` | `tests/unit/workflowSimulation.test.ts`, `tests/unit/agentGraph.test.ts`, `npm run verify` | #309 |

## Desktop Entrypoint

| Promise id | README promise | Implementation owner | Current validation | Tracking |
| --- | --- | --- | --- | --- |
| desktop-entrypoint | `tedge desktop` opens the same local cockpit in an app window or browser fallback. | `src/cli/commands/desktop.ts`, `desktop/electron-main.cjs`, `src/localCockpit/server.ts` | `tests/unit/desktopCommand.test.ts`, `npm run smoke:cli` | #155, #156 |
| desktop-lifecycle | Closing an Electron desktop window stops the local cockpit server. | `src/cli/commands/desktop.ts`, `desktop/electron-main.cjs` | `tests/unit/desktopCommand.test.ts` | #157 |
| desktop-port-fallback | Desktop mode falls forward when the requested port is occupied. | `src/cli/commands/desktop.ts`, `src/localCockpit/server.ts` | `tests/unit/localCockpit.test.ts`, `tests/unit/desktopCommand.test.ts` | #158 |

## Package And Release

| Promise id | README promise | Implementation owner | Current validation | Tracking |
| --- | --- | --- | --- | --- |
| react-primary-client | Packaged `tedge client` should serve the React cockpit build when available and fallback only when missing. | `src/localCockpit/server.ts`, `src/cockpit-web`, `package.json` | `tests/unit/cockpitWeb.test.ts`, `tests/unit/localCockpit.test.ts`, `npm run web:build` | #140, #141, #159 |
| package-assets | The npm package should include `dist/cockpit-web/index.html` and built assets. | `package.json`, `src/cockpit-web/vite.config.ts`, release scripts | `scripts/package-smoke.ts`, `tests/unit/releaseScripts.test.ts` | #160 |
| zip-assets | The zip package should include the same cockpit build with portable archive paths. | `scripts/package-zip.ts`, `package.json` | `tests/unit/releaseScripts.test.ts` | #161 |

## Editing Rule

If README wording adds or strengthens a GUI, desktop, or release-package
promise, update this map in the same PR. If the promise is not implemented or
not tested yet, link a GitHub issue instead of leaving the claim unowned.
