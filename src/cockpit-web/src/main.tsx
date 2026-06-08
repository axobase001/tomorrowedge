import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "./App.js";
import type { CockpitApprovalIntent, CockpitViewModel } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";
import {
  applyCockpitApproval,
  cockpitLiveEventsUrl,
  configureCockpitSetup,
  listCockpitSessions,
  loadCockpitSetupStatus,
  loadCockpitViewModel,
  startCockpitRun,
  testCockpitSetupProvider,
  type CockpitApiOptions,
  type CockpitProviderConnectionResult,
  type CockpitSessionSummary,
  type CockpitSetupRequest,
  type CockpitSetupStatus
} from "./api.js";

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
  capabilities: [],
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
  const [accessMode, setAccessMode] = useState<AccessMode>("partial");
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const [setupStatus, setSetupStatus] = useState<CockpitSetupStatus | undefined>(undefined);
  const [setupVisible, setSetupVisible] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | undefined>(undefined);
  const [setupConnectionResult, setSetupConnectionResult] = useState<CockpitProviderConnectionResult | undefined>(undefined);
  const liveSource = useRef<EventSource | undefined>(undefined);
  const selectedSessionRef = useRef("latest");
  const setupDismissedRef = useRef(false);

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
    if (vm.accessMode === "restricted" || vm.accessMode === "partial" || vm.accessMode === "full") setAccessMode(vm.accessMode);
    updateSelectedSession(vm.sessionId ?? sessionId);
    setStatusMessage(undefined);
  }, [apiOptions, updateSelectedSession]);

  const loadCompletedRun = useCallback(async (sessionId: string) => {
    const [nextSessions] = await Promise.all([
      listCockpitSessions(apiOptions),
      loadSession(sessionId)
    ]);
    setSessions(nextSessions);
  }, [apiOptions, loadSession]);

  const refresh = useCallback(async () => {
    try {
      const [nextSessions, nextSetupStatus] = await Promise.all([
        listCockpitSessions(apiOptions),
        loadCockpitSetupStatus(apiOptions)
      ]);
      setSessions(nextSessions);
      setSetupStatus(nextSetupStatus);
      if (nextSetupStatus.needsSetup && !setupVisible && !setupDismissedRef.current) setSetupVisible(true);
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
  }, [apiOptions, loadSession, setupVisible, updateSelectedSession]);

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
        void loadCompletedRun(sessionId).catch((error) => setStatusMessage(errorMessage(error)));
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
  }, [apiOptions, closeLiveSource, loadCompletedRun]);

  const run = useCallback(async () => {
    if (busy) {
      setStatusMessage("A workflow is already in progress. Wait for it to finish or refresh the page.");
      return;
    }
    setBusy(true);
    const useLiveModels = Boolean(setupStatus && !setupStatus.needsSetup && accessMode !== "restricted");
    setStatusMessage(useLiveModels ? "Starting workflow with live models..." : "Starting fixture workflow...");
    try {
      const payload = await startCockpitRun({
        goal: goal.trim() || "fix failing test",
        accessMode,
        fixtureMode: !useLiveModels,
        livePatch: useLiveModels,
        liveAdvisory: useLiveModels,
        liveVision: false,
        to: "core"
      }, apiOptions);
      updateSelectedSession(payload.sessionId);
      setStatusMessage("Workflow running...");
      connectLive(payload.sessionId);
    } catch (error) {
      setBusy(false);
      setStatusMessage(`Run failed: ${errorMessage(error)}`);
    }
  }, [accessMode, apiOptions, busy, connectLive, goal, setupStatus, updateSelectedSession]);

  const configureSetup = useCallback(async (request: CockpitSetupRequest) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage("Saving configuration...");
    try {
      const nextStatus = await configureCockpitSetup(request, apiOptions);
      setSetupStatus(nextStatus);
      setSetupVisible(nextStatus.needsSetup);
      if (!nextStatus.needsSetup) setupDismissedRef.current = true;
      setSetupMessage(nextStatus.needsSetup ? "Configuration saved, but the key is not visible in this process yet. Check the env var or paste the key once." : "Configuration saved. You can now run workflows.");
      setStatusMessage("Provider configured.");
    } catch (error) {
      setSetupMessage(`Setup failed: ${errorMessage(error)}`);
    } finally {
      setSetupBusy(false);
    }
  }, [apiOptions, setupBusy]);

  const testSetup = useCallback(async (provider: string) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage("Testing provider connection...");
    try {
      const result = await testCockpitSetupProvider(provider, apiOptions);
      setSetupConnectionResult(result);
      setSetupMessage(result.status === "ok" ? "Connection test passed." : "Connection test completed with a warning.");
    } catch (error) {
      setSetupMessage(`Connection test failed: ${errorMessage(error)}`);
    } finally {
      setSetupBusy(false);
    }
  }, [apiOptions, setupBusy]);

  const dismissSetup = useCallback(() => {
    setupDismissedRef.current = true;
    setSetupVisible(false);
    setSetupMessage("Fixture demo mode is available. Configure a provider when you are ready.");
  }, []);

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
    setAccessMode("partial");
    setStatusMessage("Ready for a new task.");
  }, [closeLiveSource, updateSelectedSession]);

  return (
    <App
      viewModel={viewModel}
      sessions={sessions}
      selectedSession={selectedSession}
      goal={goal}
      accessMode={accessMode}
      busy={busy}
      statusMessage={statusMessage}
      setupStatus={setupStatus}
      setupVisible={setupVisible}
      setupBusy={setupBusy}
      setupMessage={setupMessage}
      setupConnectionResult={setupConnectionResult}
      drawerOpen={drawerOpen}
      onGoalChange={setGoal}
      onAccessModeChange={setAccessMode}
      onConfigureSetup={configureSetup}
      onTestSetup={testSetup}
      onDismissSetup={dismissSetup}
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
