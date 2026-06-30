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
  submitMode: "new_task" | "continue_session";
  runPreview?: string;
  conversationTarget: string;
  testCommand: string;
  repairOnFail: boolean;
  fixtureFailingPatch: boolean;
  fullAutonomyConfirmed: boolean;
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
  onSubmitModeChange: (mode: "new_task" | "continue_session") => void;
  onTestCommandChange: (command: string) => void;
  onRepairOnFailChange: (enabled: boolean) => void;
  onFixtureFailingPatchChange: (enabled: boolean) => void;
  onFullAutonomyConfirmedChange: (enabled: boolean) => void;
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
  onCancelRun: () => void;
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
  submitMode,
  runPreview,
  conversationTarget,
  testCommand,
  repairOnFail,
  fixtureFailingPatch,
  fullAutonomyConfirmed,
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
  onSubmitModeChange,
  onTestCommandChange,
  onRepairOnFailChange,
  onFixtureFailingPatchChange,
  onFullAutonomyConfirmedChange,
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
  onCancelRun,
  onRefresh,
  onNewTask,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onApproval,
  onOpenDrawer,
  onCloseDrawer
}: AppProps) {
  const canContinueSession = Boolean(viewModel.sessionId && selectedSession !== "latest");
  const canRun = goal.trim().length > 0 && !busy && (submitMode === "continue_session"
    ? canContinueSession
    : accessMode !== "full" || fullAutonomyConfirmed);
  return (
    <main className="te-shell" data-testid="cockpit-shell">
      <TopBar viewModel={viewModel} accessMode={accessMode} busy={busy} canRun={canRun} language={language} t={t} onLanguageChange={onLanguageChange} onOpenKeys={onOpenKeyManager} onRun={onRun} onCancelRun={onCancelRun} onRefresh={onRefresh} />
      <section className="te-grid" data-testid="cockpit-grid">
        <TaskListPanel tasks={viewModel.tasks} sessions={sessions} selectedSession={selectedSession} t={t} onSelectSession={onSelectSession} onNewTask={onNewTask} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} />
        <WorkflowPanel viewModel={viewModel} busy={busy} t={t} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
        <TelemetryPanel telemetry={viewModel.telemetry} t={t} goal={viewModel.goal} onOpenDetails={onOpenDrawer} />
      </section>
      <BottomTraceSheet trace={viewModel.trace} t={t} />
      <ComposerPanel
        goal={goal}
        accessMode={accessMode}
        runMode={runMode}
        submitMode={submitMode}
        canContinueSession={canContinueSession}
        runPreview={runPreview}
        target={conversationTarget}
        testCommand={testCommand}
        repairOnFail={repairOnFail}
        fixtureFailingPatch={fixtureFailingPatch}
        fullAutonomyConfirmed={fullAutonomyConfirmed}
        busy={busy}
        statusMessage={statusMessage}
        t={t}
        onGoalChange={onGoalChange}
        onAccessModeChange={onAccessModeChange}
        onRunModeChange={onRunModeChange}
        onSubmitModeChange={onSubmitModeChange}
        onTestCommandChange={onTestCommandChange}
        onRepairOnFailChange={onRepairOnFailChange}
        onFixtureFailingPatchChange={onFixtureFailingPatchChange}
        onFullAutonomyConfirmedChange={onFullAutonomyConfirmedChange}
        onTargetChange={onConversationTargetChange}
        onSubmit={onRun}
        onCancelRun={onCancelRun}
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
