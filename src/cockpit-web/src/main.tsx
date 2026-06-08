import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "./App.js";
import type { CockpitApprovalIntent, CockpitViewModel } from "../../cockpit/contracts.js";
import type { AccessMode } from "../../config/schema.js";
import {
  applyCockpitApproval,
  cockpitLiveEventsUrl,
  configureCockpitSetup,
  deleteCockpitProviderKey,
  listCockpitSessions,
  loadCockpitSetupStatus,
  loadCockpitViewModel,
  saveCockpitProviderKey,
  saveCockpitRoleAssignments,
  startCockpitRun,
  testCockpitSetupProvider,
  type CockpitApiOptions,
  type CockpitProviderConnectionResult,
  type CockpitProviderKeyRequest,
  type CockpitRoleAssignment,
  type CockpitSessionSummary,
  type CockpitSetupRequest,
  type CockpitSetupStatus
} from "./api.js";
import { createTranslator, normalizeLanguage, type GuiLanguage } from "./i18n.js";

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
const setupDismissedStorageKey = "tomorrowedge.fixtureDemoDismissed";
const languageStorageKey = "tomorrowedge.guiLanguage";

function CockpitWebRoot() {
  const apiOptions = useMemo(readApiOptions, []);
  const [language, setLanguage] = useState<GuiLanguage>(readLanguage);
  const t = useMemo(() => createTranslator(language), [language]);
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
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const liveSource = useRef<EventSource | undefined>(undefined);
  const selectedSessionRef = useRef("latest");
  const setupDismissedRef = useRef(readSetupDismissed());

  const updateLanguage = useCallback((nextLanguage: GuiLanguage) => {
    setLanguage(nextLanguage);
    writeLanguage(nextLanguage);
  }, []);

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
        setStatusMessage(t("status.noSavedSessions"));
      }
    } catch (error) {
      const message = errorMessage(error);
      setViewModel(apiUnavailableViewModel(message, t));
      setStatusMessage(t("status.apiUnavailable", { message }));
    }
  }, [apiOptions, loadSession, setupVisible, t, updateSelectedSession]);

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
      setStatusMessage(t("view.disconnected"));
    };
  }, [apiOptions, closeLiveSource, loadCompletedRun, t]);

  const run = useCallback(async () => {
    if (busy) {
      setStatusMessage(t("status.workflowBusy"));
      return;
    }
    setBusy(true);
    const useLiveModels = Boolean(setupStatus && !setupStatus.needsSetup && accessMode !== "restricted");
    setStatusMessage(useLiveModels ? t("status.startingLive") : t("status.startingFixture"));
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
      setStatusMessage(t("status.workflowRunning"));
      connectLive(payload.sessionId);
    } catch (error) {
      setBusy(false);
      setStatusMessage(t("status.runFailed", { message: errorMessage(error) }));
    }
  }, [accessMode, apiOptions, busy, connectLive, goal, setupStatus, t, updateSelectedSession]);

  const configureSetup = useCallback(async (request: CockpitSetupRequest) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage(t("status.savingConfig"));
    try {
      const nextStatus = await configureCockpitSetup(request, apiOptions);
      setSetupStatus(nextStatus);
      setSetupVisible(nextStatus.needsSetup);
      if (!nextStatus.needsSetup) setupDismissedRef.current = true;
      setSetupMessage(nextStatus.needsSetup ? t("status.configNeedsKey") : t("status.configSaved"));
      setStatusMessage(t("status.providerConfigured"));
    } catch (error) {
      setSetupMessage(t("status.setupFailed", { message: errorMessage(error) }));
    } finally {
      setSetupBusy(false);
    }
  }, [apiOptions, setupBusy, t]);

  const saveProviderKey = useCallback(async (request: CockpitProviderKeyRequest) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage(t("status.savingKey"));
    try {
      const nextStatus = await saveCockpitProviderKey(request, apiOptions);
      setSetupStatus(nextStatus);
      setSetupVisible(nextStatus.needsSetup && !setupDismissedRef.current);
      setSetupMessage(t("status.keySaved"));
      setStatusMessage(t("status.configuredProvider", { provider: request.provider }));
    } catch (error) {
      setSetupMessage(t("status.keySaveFailed", { message: errorMessage(error) }));
    } finally {
      setSetupBusy(false);
    }
  }, [apiOptions, setupBusy, t]);

  const deleteProviderKey = useCallback(async (provider: string) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage(t("status.removingKey"));
    try {
      const nextStatus = await deleteCockpitProviderKey(provider, apiOptions);
      setSetupStatus(nextStatus);
      setSetupMessage(t("status.keyRemoved"));
      setStatusMessage(t("status.removedProvider", { provider }));
    } catch (error) {
      setSetupMessage(t("status.keyRemovalFailed", { message: errorMessage(error) }));
    } finally {
      setSetupBusy(false);
    }
  }, [apiOptions, setupBusy, t]);

  const saveRoleAssignments = useCallback(async (assignments: CockpitRoleAssignment[]) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage(t("status.savingRoles"));
    try {
      const nextStatus = await saveCockpitRoleAssignments({ assignments }, apiOptions);
      setSetupStatus(nextStatus);
      setSetupMessage(t("status.rolesSaved"));
      setStatusMessage(t("status.routingUpdated"));
    } catch (error) {
      setSetupMessage(t("status.roleSaveFailed", { message: errorMessage(error) }));
    } finally {
      setSetupBusy(false);
    }
  }, [apiOptions, setupBusy, t]);

  const testSetup = useCallback(async (provider: string) => {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupMessage(t("status.testingProvider"));
    try {
      const result = await testCockpitSetupProvider(provider, apiOptions);
      setSetupConnectionResult(result);
      setSetupMessage(result.status === "ok" ? t("status.connectionPassed") : t("status.connectionWarning"));
    } catch (error) {
      setSetupMessage(t("status.connectionFailed", { message: errorMessage(error) }));
    } finally {
      setSetupBusy(false);
    }
  }, [apiOptions, setupBusy, t]);

  const dismissSetup = useCallback(() => {
    setupDismissedRef.current = true;
    writeSetupDismissed(true);
    setSetupVisible(false);
    setSetupMessage(t("status.fixtureAvailable"));
  }, [t]);

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
      setStatusMessage(t("status.approvalFailed", { message: errorMessage(error) }));
    } finally {
      setBusy(false);
    }
  }, [apiOptions, busy, goal, t, viewModel.currentApproval?.id, viewModel.sessionId]);

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
    setStatusMessage(t("status.readyNewTask"));
  }, [closeLiveSource, t, updateSelectedSession]);

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
      keyManagerOpen={keyManagerOpen}
      drawerOpen={drawerOpen}
      language={language}
      t={t}
      onGoalChange={setGoal}
      onAccessModeChange={setAccessMode}
      onLanguageChange={updateLanguage}
      onConfigureSetup={configureSetup}
      onSaveProviderKey={saveProviderKey}
      onDeleteProviderKey={deleteProviderKey}
      onSaveRoleAssignments={saveRoleAssignments}
      onTestSetup={testSetup}
      onDismissSetup={dismissSetup}
      onOpenKeyManager={() => setKeyManagerOpen(true)}
      onCloseKeyManager={() => setKeyManagerOpen(false)}
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

function apiUnavailableViewModel(message: string, t = createTranslator("en")): CockpitViewModel {
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
      title: t("status.apiUnavailableTitle"),
      subtitle: t("status.apiUnavailableSubtitle"),
      body: message,
      filesChanged: []
    }
  };
}

function readLanguage(): GuiLanguage {
  try {
    return normalizeLanguage(window.localStorage.getItem(languageStorageKey));
  } catch {
    return "en";
  }
}

function writeLanguage(language: GuiLanguage): void {
  try {
    window.localStorage.setItem(languageStorageKey, language);
  } catch {
    // Local storage may be unavailable in hardened browser contexts.
  }
}

function readApiOptions(): CockpitApiOptions {
  const params = new URLSearchParams(window.location.search);
  return {
    nonce: params.get("nonce") ?? "",
    apiBase: params.get("api") ?? undefined
  };
}

function readSetupDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(setupDismissedStorageKey) === "true";
  } catch {
    return false;
  }
}

function writeSetupDismissed(value: boolean): void {
  try {
    window.sessionStorage.setItem(setupDismissedStorageKey, value ? "true" : "false");
  } catch {
    // Session storage may be unavailable in hardened browser contexts.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById("root")!).render(<CockpitWebRoot />);
