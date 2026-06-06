import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import type { CockpitViewModel } from "../../cockpit/contracts.js";

const emptyViewModel: CockpitViewModel = {
  version: "1",
  goal: "",
  workspace: "workspace",
  accessMode: "local",
  status: "idle",
  statusText: "等待任务",
  tasks: [],
  workflow: [],
  agents: [],
  routes: [],
  telemetry: {
    providerSummary: "offline",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    dispatched: 0,
    running: 0,
    completed: 0,
    waiting: 0,
    failed: 0,
    patchWaiting: false,
    shellWaiting: false,
    fallbackCount: 0
  },
  approvals: [],
  main: { title: "准备新任务", subtitle: "等待指令", body: "", filesChanged: [] },
  trace: [],
  rawEvents: [],
  artifacts: []
};

createRoot(document.getElementById("root")!).render(<App viewModel={emptyViewModel} />);
