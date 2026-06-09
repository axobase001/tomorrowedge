import type { CockpitApprovalIntent, CockpitRunMode, CockpitViewModel } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";
import type { CockpitProviderConnectionResult, CockpitProviderKeyRequest, CockpitProviderModelOption, CockpitRoleAssignment, CockpitSessionSummary, CockpitSetupRequest, CockpitSetupStatus } from "./api.js";
import { TopBar } from "./components/TopBar.js";
import { TaskListPanel } from "./components/TaskListPanel.js";
import { WorkflowPanel } from "./components/WorkflowPanel.js";
import { TelemetryPanel } from "./components/TelemetryPanel.js";
import { ComposerPanel } from "./components/ComposerPanel.js";
import { SetupWizard } from "./components/SetupWizard.js";
import { KeyRoleManager } from "./components/KeyRoleManager.js";
import { BottomTraceSheet } from "./components/BottomTraceSheet.js";
import { DetailDrawer } from "./components/DetailDrawer.js";
import type { GuiLanguage, Translator } from "./i18n.js";
import "./theme/tokens.css";

export type AppProps = {
  viewModel: CockpitViewModel;
  sessions: CockpitSessionSummary[];
  selectedSession: string;
  goal: string;
  accessMode: AccessMode;
  runMode: CockpitRunMode;
  conversationTarget: string;
  busy: boolean;
  statusMessage?: string;
  setupStatus?: CockpitSetupStatus;
  setupVisible: boolean;
  setupBusy: boolean;
  setupMessage?: string;
  setupConnectionResult?: CockpitProviderConnectionResult;
  keyManagerOpen: boolean;
  drawerOpen: boolean;
  language: GuiLanguage;
  t: Translator;
  onGoalChange: (goal: string) => void;
  onAccessModeChange: (mode: AccessMode) => void;
  onRunModeChange: (mode: CockpitRunMode) => void;
  onConversationTargetChange: (target: string) => void;
  onLanguageChange: (language: GuiLanguage) => void;
  onConfigureSetup: (request: CockpitSetupRequest) => void;
  onSaveProviderKey: (request: CockpitProviderKeyRequest) => void;
  onDeleteProviderKey: (provider: string) => void;
  onSaveRoleAssignments: (assignments: CockpitRoleAssignment[]) => void;
  onTestSetup: (provider: string) => void;
  onListProviderModels: (provider: string) => Promise<CockpitProviderModelOption[]>;
  onDismissSetup: () => void;
  onOpenKeyManager: () => void;
  onCloseKeyManager: () => void;
  onRun: () => void;
  onRefresh: () => void;
  onNewTask: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
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
  runMode,
  conversationTarget,
  busy,
  statusMessage,
  setupStatus,
  setupVisible,
  setupBusy,
  setupMessage,
  setupConnectionResult,
  keyManagerOpen,
  drawerOpen,
  language,
  t,
  onGoalChange,
  onAccessModeChange,
  onRunModeChange,
  onConversationTargetChange,
  onLanguageChange,
  onConfigureSetup,
  onSaveProviderKey,
  onDeleteProviderKey,
  onSaveRoleAssignments,
  onTestSetup,
  onListProviderModels,
  onDismissSetup,
  onOpenKeyManager,
  onCloseKeyManager,
  onRun,
  onRefresh,
  onNewTask,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onApproval,
  onOpenDrawer,
  onCloseDrawer
}: AppProps) {
  return (
    <main className="te-shell" data-testid="cockpit-shell">
      <TopBar viewModel={viewModel} busy={busy} language={language} t={t} onLanguageChange={onLanguageChange} onOpenKeys={onOpenKeyManager} onRun={onRun} onRefresh={onRefresh} />
      <section className="te-grid" data-testid="cockpit-grid">
        <TaskListPanel tasks={viewModel.tasks} sessions={sessions} selectedSession={selectedSession} t={t} onSelectSession={onSelectSession} onNewTask={onNewTask} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} />
        <WorkflowPanel viewModel={viewModel} busy={busy} t={t} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
        <TelemetryPanel telemetry={viewModel.telemetry} t={t} />
      </section>
      <BottomTraceSheet trace={viewModel.trace} t={t} />
      <ComposerPanel
        goal={goal}
        accessMode={accessMode}
        runMode={runMode}
        target={conversationTarget}
        busy={busy}
        statusMessage={statusMessage}
        t={t}
        onGoalChange={onGoalChange}
        onAccessModeChange={onAccessModeChange}
        onRunModeChange={onRunModeChange}
        onTargetChange={onConversationTargetChange}
        onSubmit={onRun}
      />
      <DetailDrawer viewModel={viewModel} open={drawerOpen} t={t} onClose={onCloseDrawer} />
      {keyManagerOpen ? (
        <KeyRoleManager
          setupStatus={setupStatus}
          busy={setupBusy}
          message={setupMessage}
          connectionResult={setupConnectionResult}
          t={t}
          onClose={onCloseKeyManager}
          onSaveProviderKey={onSaveProviderKey}
          onDeleteProviderKey={onDeleteProviderKey}
          onSaveRoleAssignments={onSaveRoleAssignments}
          onTestProvider={onTestSetup}
          onListProviderModels={onListProviderModels}
        />
      ) : null}
      {setupVisible ? (
        <SetupWizard
          setupStatus={setupStatus}
          busy={setupBusy}
          message={setupMessage}
          connectionResult={setupConnectionResult}
          t={t}
          onConfigure={onConfigureSetup}
          onTest={onTestSetup}
          onDismissDemo={onDismissSetup}
        />
      ) : null}
    </main>
  );
}
