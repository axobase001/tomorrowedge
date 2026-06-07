import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "./App.js";
import type { CockpitApprovalIntent, CockpitViewModel } from "../../cockpit/contracts.js";
import { applyCockpitApproval, cockpitLiveEventsUrl, listCockpitSessions, loadCockpitViewModel, startCockpitRun, type CockpitApiOptions, type CockpitSessionSummary } from "./api.js";

const emptyViewModel: CockpitViewModel = {
  version: "1",
  goal: "",
  workspace: "workspace",
  accessMode: "local",
  sessionMeta: {
    source: "empty",
    sourceLabel: "New task",
    connectionState: "idle",
    connectionLabel: "Not connected",
    fixtureMode: false,
    stale: false,
    reconnectAttempts: 0
  },
  status: "idle",
  statusText: "Awaiting task",
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
  approvalHistory: [],
  main: { title: "Ready for a new task", subtitle: "Waiting for command", body: "", filesChanged: [] },
  trace: [],
  rawEvents: [],
  artifacts: []
};

function CockpitWebRoot() {
  const apiOptions = useMemo(readApiOptions, []);
  const [viewModel, setViewModel] = useState<CockpitViewModel>(emptyViewModel);
  const [sessions, setSessions] = useState<CockpitSessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState("latest");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const liveSource = useRef<EventSource | undefined>(undefined);
  const selectedSessionRef = useRef("latest");

  const updateSelectedSession = useCallback((sessionId: string) => {
    selectedSessionRef.current = sessionId;
    setSelectedSession(sessionId);
  }, []);

  const closeLiveSource = useCallback(() => {
    liveSource.current?.close();
    liveSource.current = undefined;
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    const vm = await loadCockpitViewModel(sessionId, apiOptions);
    setViewModel(vm);
    updateSelectedSession(vm.sessionId ?? sessionId);
    setStatusMessage(undefined);
  }, [apiOptions, updateSelectedSession]);

  const refresh = useCallback(async () => {
    try {
      const nextSessions = await listCockpitSessions(apiOptions);
      setSessions(nextSessions);
      const nextSession = nextSessions.find((session) => session.sessionId === selectedSessionRef.current)?.sessionId ?? nextSessions[0]?.sessionId;
      if (nextSession) await loadSession(nextSession);
      else {
        setViewModel(emptyViewModel);
        updateSelectedSession("latest");
        setStatusMessage("No saved sessions yet.");
      }
    } catch (error) {
      const message = errorMessage(error);
      setViewModel(apiUnavailableViewModel(message));
      setStatusMessage(`Cockpit API unavailable: ${message}`);
    }
  }, [apiOptions, loadSession, updateSelectedSession]);

  useEffect(() => {
    void refresh();
    return closeLiveSource;
  }, [closeLiveSource, refresh]);

  const connectLive = useCallback((sessionId: string) => {
    closeLiveSource();
    const source = new EventSource(cockpitLiveEventsUrl(sessionId, apiOptions));
    liveSource.current = source;
    source.addEventListener("snapshot", (message) => {
      const payload = JSON.parse(message.data) as { viewModel?: CockpitViewModel; snapshot?: { done?: boolean } };
      if (payload.viewModel) setViewModel(payload.viewModel);
      if (payload.snapshot?.done) {
        setBusy(false);
        source.close();
        void loadSession(sessionId).catch((error) => setStatusMessage(errorMessage(error)));
      }
    });
    source.addEventListener("event", (message) => {
      const payload = JSON.parse(message.data) as { event?: { id?: string; timestamp?: string; type?: string; phase?: string; summary?: string } };
      if (!payload.event) return;
      setViewModel((current) => ({
        ...current,
        sessionId,
        status: current.status === "idle" ? "planning" : current.status,
        statusText: current.statusText === "Awaiting task" ? "Running" : current.statusText,
        sessionMeta: {
          ...current.sessionMeta,
          source: "live",
          sourceLabel: "Live session",
          connectionState: "connected",
          connectionLabel: "Connected",
          stale: false
        },
        trace: [{
          id: payload.event?.id ?? `${Date.now()}`,
          timestamp: payload.event?.timestamp ?? new Date().toISOString(),
          type: payload.event?.type ?? "event",
          phase: payload.event?.phase ?? "workflow",
          summary: payload.event?.summary ?? payload.event?.type ?? "event"
        }, ...current.trace].slice(0, 80)
      }));
    });
    source.onerror = () => {
      setBusy(false);
      setViewModel((current) => ({
        ...current,
        sessionMeta: {
          ...current.sessionMeta,
          connectionState: "disconnected",
          connectionLabel: "Disconnected",
          message: "Live event stream disconnected."
        }
      }));
      setStatusMessage("Live event stream disconnected.");
    };
  }, [apiOptions, closeLiveSource, loadSession]);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatusMessage("Starting workflow...");
    try {
      const payload = await startCockpitRun({
        goal: goal.trim() || "fix failing test",
        accessMode: "partial",
        fixtureMode: true,
        to: "core"
      }, apiOptions);
      updateSelectedSession(payload.sessionId);
      setStatusMessage("Workflow running...");
      connectLive(payload.sessionId);
    } catch (error) {
      setBusy(false);
      setStatusMessage(`Run failed: ${errorMessage(error)}`);
    }
  }, [apiOptions, busy, connectLive, goal, updateSelectedSession]);

  const approve = useCallback(async (action: CockpitApprovalIntent["action"]) => {
    if (!viewModel.sessionId || busy) return;
    setBusy(true);
    try {
      const payload = await applyCockpitApproval({
        action,
        sessionId: viewModel.sessionId,
        approvalId: viewModel.currentApproval?.id,
        feedback: goal
      }, apiOptions);
      if (payload.viewModel) setViewModel(payload.viewModel);
      setStatusMessage(payload.message);
    } catch (error) {
      setStatusMessage(`Approval failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [apiOptions, busy, goal, viewModel.currentApproval?.id, viewModel.sessionId]);

  const selectSession = useCallback((sessionId: string) => {
    closeLiveSource();
    updateSelectedSession(sessionId);
    void loadSession(sessionId).catch((error) => setStatusMessage(errorMessage(error)));
  }, [closeLiveSource, loadSession, updateSelectedSession]);

  const newTask = useCallback(() => {
    closeLiveSource();
    updateSelectedSession("latest");
    setViewModel(emptyViewModel);
    setGoal("");
    setStatusMessage("Ready for a new task.");
  }, [closeLiveSource, updateSelectedSession]);

  return (
    <App
      viewModel={viewModel}
      sessions={sessions}
      selectedSession={selectedSession}
      goal={goal}
      busy={busy}
      statusMessage={statusMessage}
      drawerOpen={drawerOpen}
      onGoalChange={setGoal}
      onRun={run}
      onRefresh={refresh}
      onNewTask={newTask}
      onSelectSession={selectSession}
      onApproval={approve}
      onOpenDrawer={() => setDrawerOpen(true)}
      onCloseDrawer={() => setDrawerOpen(false)}
    />
  );
}

function apiUnavailableViewModel(message: string): CockpitViewModel {
  return {
    ...emptyViewModel,
    status: "failed",
    statusText: "API unavailable",
    sessionMeta: {
      source: "api_unavailable",
      sourceLabel: "API unavailable",
      connectionState: "unavailable",
      connectionLabel: "Unavailable",
      fixtureMode: false,
      stale: true,
      reconnectAttempts: 0,
      message
    },
    main: {
      title: "Cockpit API unavailable",
      subtitle: "Local server is not reachable",
      body: message,
      filesChanged: []
    }
  };
}

function readApiOptions(): CockpitApiOptions {
  const params = new URLSearchParams(window.location.search);
  return {
    nonce: params.get("nonce") ?? "",
    apiBase: params.get("api") ?? undefined
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById("root")!).render(<CockpitWebRoot />);
