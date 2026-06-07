import type { CockpitApprovalIntent, CockpitViewModel } from "../../cockpit/contracts.js";
import type { CockpitSessionSummary } from "./api.js";
import { TopBar } from "./components/TopBar.js";
import { TaskListPanel } from "./components/TaskListPanel.js";
import { WorkflowPanel } from "./components/WorkflowPanel.js";
import { TelemetryPanel } from "./components/TelemetryPanel.js";
import { ComposerPanel } from "./components/ComposerPanel.js";
import { BottomTraceSheet } from "./components/BottomTraceSheet.js";
import { DetailDrawer } from "./components/DetailDrawer.js";
import "./theme/tokens.css";

export type AppProps = {
  viewModel: CockpitViewModel;
  sessions: CockpitSessionSummary[];
  selectedSession: string;
  goal: string;
  busy: boolean;
  statusMessage?: string;
  drawerOpen: boolean;
  onGoalChange: (goal: string) => void;
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
  busy,
  statusMessage,
  drawerOpen,
  onGoalChange,
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
      <TopBar viewModel={viewModel} busy={busy} onRun={onRun} onRefresh={onRefresh} />
      <section className="te-grid" data-testid="cockpit-grid">
        <TaskListPanel tasks={viewModel.tasks} sessions={sessions} selectedSession={selectedSession} onSelectSession={onSelectSession} onNewTask={onNewTask} />
        <WorkflowPanel viewModel={viewModel} busy={busy} onApproval={onApproval} onOpenDrawer={onOpenDrawer} />
        <TelemetryPanel telemetry={viewModel.telemetry} />
      </section>
      <BottomTraceSheet trace={viewModel.trace} />
      <ComposerPanel goal={goal} busy={busy} statusMessage={statusMessage} onGoalChange={onGoalChange} onSubmit={onRun} />
      <DetailDrawer viewModel={viewModel} open={drawerOpen} onClose={onCloseDrawer} />
    </main>
  );
}
