import type { CockpitApprovalIntent, CockpitViewModel } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";
import type { CockpitProviderConnectionResult, CockpitSessionSummary, CockpitSetupRequest, CockpitSetupStatus, CockpitApiOptions } from "./api.js";
import { TopBar } from "./components/TopBar.js";
import { TaskListPanel } from "./components/TaskListPanel.js";
import { WorkflowPanel } from "./components/WorkflowPanel.js";
import { TelemetryPanel } from "./components/TelemetryPanel.js";
import { ComposerPanel } from "./components/ComposerPanel.js";
import { SetupWizard } from "./components/SetupWizard.js";
import { SecretPanel } from "./components/SecretPanel.js";
import { BottomTraceSheet } from "./components/BottomTraceSheet.js";
import { DetailDrawer } from "./components/DetailDrawer.js";
import "./theme/tokens.css";

export type AppProps = {
  viewModel: CockpitViewModel;
  sessions: CockpitSessionSummary[];
  selectedSession: string;
  goal: string;
  accessMode: AccessMode;
  busy: boolean;
  apiOptions: CockpitApiOptions;
  statusMessage?: string;
  setupStatus?: CockpitSetupStatus;
  setupVisible: boolean;
  setupBusy: boolean;
  setupMessage?: string;
  setupConnectionResult?: CockpitProviderConnectionResult;
  drawerOpen: boolean;
  secretPanelOpen: boolean;
  onGoalChange: (goal: string) => void;
  onAccessModeChange: (mode: AccessMode) => void;
  onConfigureSetup: (request: CockpitSetupRequest) => void;
  onTestSetup: (provider: string) => void;
  onDismissSetup: () => void;
  onRun: () => void;
  onRefresh: () => void;
  onNewTask: () => void;
  onSelectSession: (sessionId: string) => void;
  onApproval: (action: CockpitApprovalIntent["action"]) => void;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
  onOpenSecretPanel: () => void;
  onCloseSecretPanel: () => void;
};

export function App({
  viewModel,
  sessions,
  selectedSession,
  goal,
  accessMode,
  busy,
  apiOptions,
  statusMessage,
  setupStatus,
  setupVisible,
  setupBusy,
  setupMessage,
  setupConnectionResult,
  drawerOpen,
  secretPanelOpen,
  onGoalChange,
  onAccessModeChange,
  onConfigureSetup,
  onTestSetup,
  onDismissSetup,
  onRun,
  onRefresh,
  onNewTask,
  onSelectSession,
  onApproval,
  onOpenDrawer,
  onCloseDrawer,
  onOpenSecretPanel,
  onCloseSecretPanel
}: AppProps) {
  return (
    <main className="te-shell" data-testid="cockpit-shell">
      <TopBar viewModel={viewModel} busy={busy} onRun={onRun} onRefresh={onRefresh} onOpenKeys={onOpenSecretPanel} />
      <section className="te-grid" data-testid="cockpit-grid">
        <TaskListPanel tasks={viewModel.tasks} sessions={sessions} selectedSession={selectedSession} onSelectSession={onSelectSession} onNewTask={onNewTask} />
        <WorkflowPanel viewModel={viewModel} busy={busy} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
        <TelemetryPanel telemetry={viewModel.telemetry} />
      </section>
      <BottomTraceSheet trace={viewModel.trace} />
      <ComposerPanel goal={goal} accessMode={accessMode} busy={busy} statusMessage={statusMessage} onGoalChange={onGoalChange} onAccessModeChange={onAccessModeChange} onSubmit={onRun} />
      <DetailDrawer viewModel={viewModel} open={drawerOpen} onClose={onCloseDrawer} />
      {setupVisible ? (
        <SetupWizard
          setupStatus={setupStatus}
          busy={setupBusy}
          message={setupMessage}
          connectionResult={setupConnectionResult}
          onConfigure={onConfigureSetup}
          onTest={onTestSetup}
          onDismissDemo={onDismissSetup}
        />
      ) : null}
      {secretPanelOpen ? (
        <SecretPanel apiOptions={apiOptions} onClose={onCloseSecretPanel} />
      ) : null}
    </main>
  );
}
