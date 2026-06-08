import type { CockpitApprovalIntent, CockpitViewModel } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";
import type { CockpitProviderConnectionResult, CockpitProviderKeyRequest, CockpitRoleAssignment, CockpitSessionSummary, CockpitSetupRequest, CockpitSetupStatus } from "./api.js";
import { TopBar } from "./components/TopBar.js";
import { TaskListPanel } from "./components/TaskListPanel.js";
import { WorkflowPanel } from "./components/WorkflowPanel.js";
import { TelemetryPanel } from "./components/TelemetryPanel.js";
import { ComposerPanel } from "./components/ComposerPanel.js";
import { SetupWizard } from "./components/SetupWizard.js";
import { KeyRoleManager } from "./components/KeyRoleManager.js";
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
  statusMessage?: string;
  setupStatus?: CockpitSetupStatus;
  setupVisible: boolean;
  setupBusy: boolean;
  setupMessage?: string;
  setupConnectionResult?: CockpitProviderConnectionResult;
  keyManagerOpen: boolean;
  drawerOpen: boolean;
  onGoalChange: (goal: string) => void;
  onAccessModeChange: (mode: AccessMode) => void;
  onConfigureSetup: (request: CockpitSetupRequest) => void;
  onSaveProviderKey: (request: CockpitProviderKeyRequest) => void;
  onDeleteProviderKey: (provider: string) => void;
  onSaveRoleAssignments: (assignments: CockpitRoleAssignment[]) => void;
  onTestSetup: (provider: string) => void;
  onDismissSetup: () => void;
  onOpenKeyManager: () => void;
  onCloseKeyManager: () => void;
  onRun: () => void;
  onRefresh: () => void;
  onNewTask: () => void;
  onSelectSession: (sessionId: string) => void;
  onApproval: (action: CockpitApprovalIntent["action"]) => void;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
};

export function App({
  viewModel,
  sessions,
  selectedSession,
  goal,
  accessMode,
  busy,
  statusMessage,
  setupStatus,
  setupVisible,
  setupBusy,
  setupMessage,
  setupConnectionResult,
  keyManagerOpen,
  drawerOpen,
  onGoalChange,
  onAccessModeChange,
  onConfigureSetup,
  onSaveProviderKey,
  onDeleteProviderKey,
  onSaveRoleAssignments,
  onTestSetup,
  onDismissSetup,
  onOpenKeyManager,
  onCloseKeyManager,
  onRun,
  onRefresh,
  onNewTask,
  onSelectSession,
  onApproval,
  onOpenDrawer,
  onCloseDrawer
}: AppProps) {
  return (
    <main className="te-shell" data-testid="cockpit-shell">
      <TopBar viewModel={viewModel} busy={busy} onOpenKeys={onOpenKeyManager} onRun={onRun} onRefresh={onRefresh} />
      <section className="te-grid" data-testid="cockpit-grid">
        <TaskListPanel tasks={viewModel.tasks} sessions={sessions} selectedSession={selectedSession} onSelectSession={onSelectSession} onNewTask={onNewTask} />
        <WorkflowPanel viewModel={viewModel} busy={busy} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
        <TelemetryPanel telemetry={viewModel.telemetry} />
      </section>
      <BottomTraceSheet trace={viewModel.trace} />
      <ComposerPanel goal={goal} accessMode={accessMode} busy={busy} statusMessage={statusMessage} onGoalChange={onGoalChange} onAccessModeChange={onAccessModeChange} onSubmit={onRun} />
      <DetailDrawer viewModel={viewModel} open={drawerOpen} onClose={onCloseDrawer} />
      {keyManagerOpen ? (
        <KeyRoleManager
          setupStatus={setupStatus}
          busy={setupBusy}
          message={setupMessage}
          connectionResult={setupConnectionResult}
          onClose={onCloseKeyManager}
          onSaveProviderKey={onSaveProviderKey}
          onDeleteProviderKey={onDeleteProviderKey}
          onSaveRoleAssignments={onSaveRoleAssignments}
          onTestProvider={onTestSetup}
        />
      ) : null}
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
    </main>
  );
}
