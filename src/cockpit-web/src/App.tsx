import type { CockpitViewModel } from "../../cockpit/contracts.js";
import { TopBar } from "./components/TopBar.js";
import { TaskListPanel } from "./components/TaskListPanel.js";
import { WorkflowPanel } from "./components/WorkflowPanel.js";
import { TelemetryPanel } from "./components/TelemetryPanel.js";
import { ComposerPanel } from "./components/ComposerPanel.js";
import { BottomTraceSheet } from "./components/BottomTraceSheet.js";
import { DetailDrawer } from "./components/DetailDrawer.js";
import "./theme/tokens.css";

export function App({ viewModel }: { viewModel: CockpitViewModel }) {
  return (
    <main className="te-shell">
      <TopBar viewModel={viewModel} />
      <section className="te-grid">
        <TaskListPanel tasks={viewModel.tasks} />
        <WorkflowPanel viewModel={viewModel} />
        <TelemetryPanel telemetry={viewModel.telemetry} />
      </section>
      <BottomTraceSheet trace={viewModel.trace} />
      <ComposerPanel />
      <DetailDrawer viewModel={viewModel} />
    </main>
  );
}
