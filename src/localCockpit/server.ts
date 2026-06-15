import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OfflineGraphOptions } from "../core/agentGraph/executor.js";
import { deleteSession, loadLatestSession, loadSession, listSessions, renameSessionGoal, saveSession } from "../core/memory/sessionMemory.js";
import { NativeBackend } from "../core/orchestration/nativeBackend.js";
import { createOrchestrationBackend } from "../core/orchestration/registry.js";
import { runAgentCouncilGovernance } from "../core/council/councilRuntime.js";
import { prepareRunWorkspace, resolveRuntimeConfig, shouldAutoLive, liveOption } from "../core/runtime/runPreparation.js";
import { TomorrowEdgeMcpBridge } from "../mcp/bridge.js";
import { cockpitIconSvg, cockpitManifest } from "./brand.js";
import { renderCockpitHtml } from "./html.js";
import type { AccessMode, TomorrowEdgeConfig } from "../config/schema.js";
import type { ExternalAgentRegistrationInput } from "../core/externalAgents/externalAgentTypes.js";
import { agentRoles, type AgentRole } from "../schemas/agentTask.js";
import { redactText } from "../safety/secretScanner.js";
import { buildCockpitViewModel } from "../cockpit/viewModel.js";
import { cockpitEventBus } from "../cockpit/eventBus.js";
import { isAllowedBrowserOrigin, isAuthorizedCockpitRequest } from "../cockpit/auth.js";
import { recordApprovalIntent } from "../cockpit/approvals.js";
import type { CockpitApprovalIntent, CockpitRunMode } from "../cockpit/contracts.js";
import { safeArtifactPath } from "../cockpit/artifacts.js";
import { executeCockpitApprovalAction } from "../cockpit/approvalExecutor.js";
import { buildAccessPolicy } from "../core/permissions/accessPolicy.js";
import { createBudgetRuntimeState } from "../core/budget/budgetGate.js";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";
import { log } from "../utils/logger.js";
import {
  configureCockpitProvider,
  deleteCockpitProviderKey,
  getCockpitSetupStatus,
  listCockpitProviderModels,
  saveCockpitProviderKey,
  saveCockpitRoleAssignments,
  testCockpitProvider
} from "./setup.js";

export type LocalCockpitServerOptions = {
  port?: number;
  host?: string;
  webRoot?: string | false;
  configPath?: string;
};

export type LocalCockpitHandle = {
  server: Server;
  url: string;
  openUrl: string;
  nonce: string;
  requestedPort: number;
  port: number;
  close: () => Promise<void>;
};

const maxJsonBodyBytes = 1_000_000;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export async function startLocalCockpitServer(cwd: string, options: LocalCockpitServerOptions = {}): Promise<LocalCockpitHandle> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 18792;
  const nonce = randomBytes(24).toString("base64url");
  const { server, port } = await listenOnAvailablePort(cwd, host, requestedPort, nonce, options.webRoot, options.configPath);
  const url = `http://${host}:${port}`;
  return {
    server,
    url,
    openUrl: url,
    nonce,
    requestedPort,
    port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function listenOnAvailablePort(cwd: string, host: string, requestedPort: number, nonce: string, webRoot: string | false | undefined, configPath?: string): Promise<{ server: Server; port: number }> {
  if (requestedPort === 0) return listenOnce(cwd, host, 0, nonce, webRoot, configPath);
  const maxAttempts = 20;
  let lastError: unknown;
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = requestedPort + offset;
    try {
      return await listenOnce(cwd, host, port, nonce, webRoot, configPath);
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No available port found starting at ${requestedPort}.`);
}

async function listenOnce(cwd: string, host: string, port: number, nonce: string, webRoot: string | false | undefined, configPath?: string): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    void routeRequest(cwd, request, response, nonce, webRoot, configPath);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((error) => {
    server.close();
    throw error;
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  return { server, port: boundPort };
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE");
}

async function routeRequest(cwd: string, request: IncomingMessage, response: ServerResponse, nonce: string, webRoot?: string | false, configPath?: string): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/cockpit")) {
      return sendCockpitShell(response, nonce, webRoot);
    }
    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      const sent = await sendCockpitAsset(response, url.pathname, webRoot);
      if (sent) return;
    }
    if (request.method === "GET" && (url.pathname === "/icon.svg" || url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")) {
      return send(response, 200, cockpitIconSvg, "image/svg+xml; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/manifest.webmanifest") {
      return sendJson(response, 200, cockpitManifest());
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "tomorrowedge-local-cockpit" });
    }
    if (url.pathname.startsWith("/api/") && !isAuthorizedCockpitRequest(request, url, nonce)) {
      return sendJson(response, 403, { error: "forbidden", message: "Missing or invalid local cockpit access token." });
    }
    if (url.pathname.startsWith("/api/") && isMutatingMethod(request.method) && !isAllowedBrowserOrigin(request)) {
      return sendJson(response, 403, { error: "forbidden", message: "Cross-origin cockpit API writes are not allowed." });
    }
    if (request.method === "GET" && url.pathname === "/api/sessions") {
      const sessions = await listSessions(cwd);
      return sendJson(response, 200, sessions.map((session) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        eventCount: session.eventCount ?? session.state.events?.length ?? 0,
        artifactCount: session.artifactCount ?? session.state.eventArtifacts?.length ?? 0,
        goal: session.state.goal,
        result: session.state.finalSummary?.result
      })));
    }
    if (request.method === "GET" && url.pathname === "/api/setup/status") {
      return sendJson(response, 200, getCockpitSetupStatus(cwd));
    }
    if (request.method === "POST" && url.pathname === "/api/setup/configure") {
      const body = await readJsonBody(request);
      const status = await toSetupHttpResult(() => configureCockpitProvider(cwd, parseSetupRequest(body)));
      return sendJson(response, 200, status);
    }
    const setupKeyMatch = /^\/api\/setup\/keys\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && setupKeyMatch) {
      const body = await readJsonBody(request);
      const status = await toSetupHttpResult(() => saveCockpitProviderKey(cwd, parseProviderKeyRequest(decodeURIComponent(setupKeyMatch[1]), body)));
      return sendJson(response, 200, status);
    }
    if (request.method === "DELETE" && setupKeyMatch) {
      requireDestructiveConfirmation(url, "delete_key_confirmation_required", "Provider key deletion requires confirmed=true.");
      const status = await toSetupHttpResult(() => deleteCockpitProviderKey(cwd, decodeURIComponent(setupKeyMatch[1])));
      return sendJson(response, 200, status);
    }
    if (request.method === "PUT" && url.pathname === "/api/setup/roles") {
      const body = await readJsonBody(request);
      const status = await toSetupHttpResult(() => saveCockpitRoleAssignments(cwd, parseRoleAssignmentsRequest(body)));
      return sendJson(response, 200, status);
    }
    if (request.method === "POST" && url.pathname === "/api/setup/test") {
      const body = await readJsonBody(request);
      const provider = typeof body.provider === "string" ? body.provider : "";
      if (!provider.trim()) throw new HttpError(400, "provider_required", "provider is required.");
      return sendJson(response, 200, await toSetupHttpResult(() => testCockpitProvider(cwd, provider)));
    }
    if (request.method === "GET" && url.pathname === "/api/setup/models") {
      const provider = url.searchParams.get("provider") ?? "";
      if (!provider.trim()) throw new HttpError(400, "provider_required", "provider is required.");
      const limit = parseLimitParam(url.searchParams.get("limit"), 20);
      return sendJson(response, 200, await toSetupHttpResult(() => listCockpitProviderModels(cwd, provider, limit)));
    }
    const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && sessionMatch) {
      const session = await loadRequiredSession(cwd, decodeURIComponent(sessionMatch[1]));
      return sendJson(response, 200, session);
    }
    if (request.method === "PATCH" && sessionMatch) {
      const sessionId = await resolveMutableSessionId(cwd, decodeURIComponent(sessionMatch[1]));
      const body = await readJsonBody(request);
      const goal = typeof body.goal === "string" ? body.goal.trim() : typeof body.title === "string" ? body.title.trim() : "";
      if (!goal) throw new HttpError(400, "session_goal_required", "Session rename requires a non-empty goal or title.");
      const session = await renameSessionGoal(cwd, sessionId, goal);
      return sendJson(response, 200, {
        sessionId: session.sessionId,
        goal: session.state.goal,
        viewModel: buildCockpitViewModel(cwd, session.state, { source: "saved" })
      });
    }
    if (request.method === "DELETE" && sessionMatch) {
      requireDestructiveConfirmation(url, "delete_session_confirmation_required", "Session deletion requires confirmed=true.");
      const sessionId = await resolveMutableSessionId(cwd, decodeURIComponent(sessionMatch[1]));
      await deleteSession(cwd, sessionId);
      const sessions = await listSessions(cwd);
      return sendJson(response, 200, sessions.map((session) => ({
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        eventCount: session.eventCount ?? session.state.events?.length ?? 0,
        artifactCount: session.artifactCount ?? session.state.eventArtifacts?.length ?? 0,
        goal: session.state.goal,
        result: session.state.finalSummary?.result
      })));
    }
    const viewModelMatch = /^\/api\/sessions\/([^/]+)\/view-model$/.exec(url.pathname);
    if (request.method === "GET" && viewModelMatch) {
      const session = await loadRequiredSession(cwd, decodeURIComponent(viewModelMatch[1]));
      return sendJson(response, 200, buildCockpitViewModel(cwd, session.state, { source: "saved" }));
    }
    const eventsMatch = /^\/api\/sessions\/([^/]+)\/events$/.exec(url.pathname);
    if (request.method === "GET" && eventsMatch) {
      const session = await loadRequiredSession(cwd, decodeURIComponent(eventsMatch[1]));
      return sendJson(response, 200, session.state.events ?? []);
    }
    const liveEventsMatch = /^\/api\/runs\/([^/]+)\/events\/live$/.exec(url.pathname);
    if (request.method === "GET" && liveEventsMatch) {
      return sendLiveEvents(cwd, response, decodeURIComponent(liveEventsMatch[1]));
    }
    const artifactMatch = /^\/api\/sessions\/([^/]+)\/artifacts\/(.+)$/.exec(url.pathname);
    if (request.method === "GET" && artifactMatch) {
      return sendArtifact(cwd, response, decodeURIComponent(artifactMatch[1]), decodeURIComponent(artifactMatch[2]));
    }
    if (request.method === "POST" && url.pathname === "/api/runs") {
      const body = await readJsonBody(request);
      const goal = typeof body.goal === "string" ? body.goal.trim() : "";
      if (!goal) throw new HttpError(400, "goal_required", "Run requires a non-empty goal.");
      const { prefs, memoryHints, config } = await resolveRuntimeConfig(cwd, { task: goal, configPath });
      const sessionId = `session_${randomBytes(8).toString("hex")}`;
      const requestedRunMode = parseRunMode(body.runMode);
      const accessMode = parseAccessMode(body.accessMode) ?? prefs.accessMode ?? config.project.access_mode;
      const runFlags = resolveRunFlags(requestedRunMode, body, config);
      const liveState = createLiveState(sessionId, goal, config, accessMode);
      const workspace = await prepareRunWorkspace(cwd, { fixtureMode: runFlags.fixtureMode, forceFixtureWorkspace: runFlags.fixtureMode });
      const options: OfflineGraphOptions = {
        fixtureMode: runFlags.fixtureMode,
        accessMode,
        livePatch: runFlags.livePatch,
        liveAdvisory: runFlags.liveAdvisory,
        liveVision: Boolean(body.liveVision),
        approvePatch: Boolean(body.approvePatch),
        approveShell: Boolean(body.approveShell),
        repairOnFail: Boolean(body.repairOnFail),
        approveRepair: Boolean(body.approveRepair),
        conversationTarget: typeof body.to === "string" ? body.to : "core",
        testCommand: typeof body.testCommand === "string" && body.testCommand.trim()
          ? body.testCommand.trim()
          : prefs.preferredTestCommand ?? (config.strategy_memory.suggest_test_command ? memoryHints?.preferredTestCommand : undefined),
        sessionId,
        onEvent: (event) => {
          applyLiveEvent(liveState, event);
          cockpitEventBus.emitEvent(sessionId, event);
          cockpitEventBus.setSnapshot({ sessionId, state: liveState, done: false });
        }
      };
      const runPromise = requestedRunMode === "council"
        ? runAgentCouncilGovernance(workspace.executionCwd, goal, config, {
          accessMode,
          fixtureMode: runFlags.fixtureMode,
          approvePatch: Boolean(body.approvePatch),
          approveShell: Boolean(body.approveShell),
          sessionId,
          onEvent: options.onEvent
        })
        : runCockpitBackend(createOrchestrationBackend(config), workspace.executionCwd, goal, options);
      void runPromise
        .then(async (state) => {
          await saveSession(cwd, state, { failureMemory: config.failure_memory });
          cockpitEventBus.setSnapshot({ sessionId: state.sessionId, state, done: true });
        })
        .catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          const failedState = markLiveRunFailed(liveState, message);
          try {
            await saveSession(cwd, failedState, { failureMemory: config.failure_memory });
          } catch (saveError) {
            log("warn", `Failed to save failed live cockpit session ${sessionId}: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
            // The live cockpit should still expose the in-memory failure snapshot.
          }
          cockpitEventBus.setSnapshot({
            sessionId,
            state: failedState,
            done: true,
            error: message
          });
        });
      return sendJson(response, 202, { sessionId, status: "started" });
    }
    if (request.method === "POST" && url.pathname === "/api/approvals") {
      const body = await readJsonBody(request);
      const parsedIntent = parseApprovalIntent(body);
      const session = await loadRequiredSession(cwd, parsedIntent.sessionId);
      validateApprovalIntent(cwd, session.state, parsedIntent);
      const intent = recordApprovalIntent(parsedIntent);
      const result = await executeCockpitApprovalAction(cwd, session.state, intent);
      const { config } = await resolveRuntimeConfig(cwd, { configPath });
      await saveSession(cwd, result.state, { failureMemory: config.failure_memory });
      cockpitEventBus.setSnapshot({ sessionId: result.state.sessionId, state: result.state, done: false });
      return sendJson(response, 200, {
        status: "applied",
        intent,
        message: result.message,
        viewModel: buildCockpitViewModel(cwd, result.state, { source: "saved" })
      });
    }
    if (request.method === "POST" && url.pathname === "/api/mcp/register") {
      const body = await readJsonBody(request);
      const registration = parseExternalAgentRegistration(body);
      await loadRequiredSession(cwd, registration.sessionId);
      const bridge = new TomorrowEdgeMcpBridge(cwd);
      const result = await bridge.registerExternalAgent(registration);
      return sendJson(response, 200, result);
    }
    return sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) return sendJson(response, error.status, { error: error.code, message: error.message });
    return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function validateApprovalIntent(cwd: string, state: AgentGraphState, intent: CockpitApprovalIntent): void {
  const viewModel = buildCockpitViewModel(cwd, state, { source: "saved" });
  const active = viewModel.currentApproval;
  const approvalActions = new Set<CockpitApprovalIntent["action"]>(["approve_patch", "reject_patch", "approve_shell", "reject_shell"]);
  if (!approvalActions.has(intent.action)) {
    if (intent.approvalId && active && intent.approvalId !== active.id) {
      throw new HttpError(409, "approval_mismatch", `Approval ${intent.approvalId} is no longer active. Current approval is ${active.id}.`);
    }
    return;
  }
  if (!active) throw new HttpError(409, "no_active_approval", "No approval is currently waiting for this session.");
  if (!intent.approvalId) throw new HttpError(400, "approval_id_required", "Approval actions require the active approvalId.");
  if (intent.approvalId !== active.id) {
    throw new HttpError(409, "approval_mismatch", `Approval ${intent.approvalId} is no longer active. Current approval is ${active.id}.`);
  }
  const patchAction = intent.action === "approve_patch" || intent.action === "reject_patch";
  const shellAction = intent.action === "approve_shell" || intent.action === "reject_shell";
  if (patchAction && active.kind === "shell") throw new HttpError(409, "approval_mismatch", `Current approval ${active.id} is a shell approval.`);
  if (shellAction && active.kind !== "shell") throw new HttpError(409, "approval_mismatch", `Current approval ${active.id} is not a shell approval.`);
}

async function runCockpitBackend(
  backend: ReturnType<typeof createOrchestrationBackend>,
  executionCwd: string,
  goal: string,
  options: OfflineGraphOptions
): Promise<AgentGraphState> {
  if (!(backend instanceof NativeBackend)) {
    for await (const _event of backend.run({ cwd: executionCwd, goal, options })) {
      // Placeholder adapters are surfaced as explicit backend errors below.
    }
    throw new Error(`Backend ${backend.id} completed without producing a native graph state.`);
  }
  return backend.runGraph(executionCwd, goal, options);
}

function resolveRunFlags(runMode: CockpitRunMode, body: Record<string, unknown>, config: TomorrowEdgeConfig): { fixtureMode: boolean; livePatch: boolean; liveAdvisory: boolean } {
  const live = runMode === "live";
  const offline = runMode === "offline";
  const council = runMode === "council";
  const fixtureMode = runMode === "fixture"
    ? true
    : live || offline || council
      ? false
      : body.fixtureMode !== false;
  const autoLive = shouldAutoLive(config, { fixtureMode, live, offline });
  return {
    fixtureMode,
    livePatch: liveOption(offline, live, autoLive, booleanOrUndefined(body.livePatch)),
    liveAdvisory: liveOption(offline, live, autoLive, booleanOrUndefined(body.liveAdvisory))
  };
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function toSetupHttpResult<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, "setup_error", message);
  }
}

function createLiveState(sessionId: string, goal: string, config: TomorrowEdgeConfig, mode?: AccessMode): AgentGraphState {
  const access = buildAccessPolicy(config, { mode });
  return {
    sessionId,
    goal,
    conversationTarget: undefined,
    routing: { mode: config.routing.mode, privacyLocked: false, assignments: [], fallbacks: [] },
    access,
    events: [],
    eventArtifacts: [],
    providerViews: [],
    evidencePackets: [],
    agents: [],
    candidates: [],
    repairCandidates: [],
    debateRounds: [],
    modelNotes: [],
    usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    budgetRuntime: createBudgetRuntimeState(),
    budgetStatuses: [],
    changedFiles: [],
    runResults: [],
    approvals: {
      patchApproved: access.patchApproved,
      shellApproved: access.shellApproved,
      repairApproved: access.repairApproved
    }
  };
}

export function markLiveRunFailed(state: AgentGraphState, error: string): AgentGraphState {
  return {
    ...state,
    finalSummary: {
      task: state.goal,
      result: "failed",
      userReply: `I could not complete the workflow. ${error}`,
      userReplySource: "blocked",
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: state.events.length ? [`${state.events.length} event(s) recorded before workflow failure`] : [],
      risksRemaining: [error],
      suggestedCommitMessage: `chore: investigate ${state.changedFiles[0] ?? "workflow"} failure`
    }
  };
}

function applyLiveEvent(state: AgentGraphState, event: TomorrowEdgeEvent): void {
  state.events.push(event);
  if (event.type === "model_call" && event.role) {
    upsertLiveAgent(state, {
      id: `live_${event.role}`,
      role: event.role,
      provider: event.provider ?? "provider",
      model: event.model ?? "model",
      status: event.status === "failure" ? "failed" : event.status === "success" ? "success" : "running",
      agentKind: "live",
      summary: event.error ?? event.status ?? "model_call"
    });
    state.usageSummary.inputTokens += event.inputTokens ?? 0;
    state.usageSummary.outputTokens += event.outputTokens ?? 0;
    state.usageSummary.totalTokens += (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
    state.usageSummary.estimatedCostUsd = (state.usageSummary.estimatedCostUsd ?? 0) + (event.estimatedCostUsd ?? 0);
  }
  if (event.type === "agent_run" && event.role) {
    upsertLiveAgent(state, {
      id: event.runId || `live_${event.role}`,
      role: event.role,
      provider: event.provider ?? "provider",
      model: event.model ?? "model",
      status: event.status === "failure" ? "failed" : event.status === "blocked" ? "waiting_for_user" : "success",
      agentKind: event.agentKind ?? "live",
      summary: event.error ?? `agent ${event.status}`
    });
  }
  if (event.type === "access_mode") {
    state.access = {
      ...state.access,
      mode: event.accessMode,
      cloudAllowed: event.cloudAllowed,
      patchApproved: event.patchApproved,
      shellApproved: event.shellApproved,
      repairApproved: event.repairApproved
    };
    state.approvals = {
      patchApproved: event.patchApproved,
      shellApproved: event.shellApproved,
      repairApproved: event.repairApproved
    };
  }
  if (event.type === "routing_decision") {
    state.routing.assignments.push({
      role: event.assignedRole,
      provider: event.assignedProvider,
      model: event.assignedModel,
      reason: event.reason
    });
  }
  if (event.type === "patch_candidate") {
    state.candidates.push({
      candidateId: event.candidateId,
      agentId: event.role ?? "coder_a",
      approach: isPatchApproach(event.approach) ? event.approach : "minimal_patch",
      summary: event.summary,
      filesChanged: event.filesChanged,
      unifiedDiff: "",
      testPlan: [],
      knownTradeoffs: [],
      estimatedRisk: event.estimatedRisk
    });
  }
  if (event.type === "judge_decision") {
    state.judge = {
      decision: event.decision === "select" ? "select" : event.decision === "ask_user" ? "ask_user" : event.decision === "abort" ? "abort" : "request_revision",
      selectedCandidateId: event.selectedCandidateId,
      reason: event.reason,
      confidence: event.confidence
    };
  }
  if (event.type === "patch_apply") {
    if (event.applied) {
      state.changedFiles = [...new Set([...state.changedFiles, ...event.filesChanged])];
      state.approvals.patchApproved = true;
    } else if (event.error) {
      state.agents.push({
        id: "live_approval_patch",
        role: "runner",
        provider: "local_tool",
        model: "approval_gate",
        status: "waiting_for_user",
        summary: event.error
      });
    }
  }
  if (event.type === "shell_run" && typeof event.success === "boolean") {
    state.runResults.push({
      command: event.command,
      exitCode: event.exitCode ?? (event.success ? 0 : 1),
      stdout: "",
      stderr: event.error ?? "",
      durationMs: event.durationMs ?? 0,
      success: event.success
    });
  }
  if (event.type === "summary") {
    state.finalSummary = {
      task: state.goal,
      result: event.result as "completed" | "partially_completed" | "failed" | "aborted",
      changedFiles: state.changedFiles,
      testsRun: state.runResults.map((result) => result.command),
      evidence: [event.summaryRef],
      risksRemaining: [],
      suggestedCommitMessage: `chore: update ${state.changedFiles[0] ?? "workspace"}`
    };
  }
}

function upsertLiveAgent(state: AgentGraphState, agent: AgentGraphState["agents"][number]): void {
  const index = state.agents.findIndex((item) => item.role === agent.role && item.provider === agent.provider && item.model === agent.model);
  if (index >= 0) {
    state.agents[index] = { ...state.agents[index]!, ...agent };
  } else {
    state.agents.push(agent);
  }
}

function isPatchApproach(value: string): value is "minimal_patch" | "refactor" | "test_first" | "alternative" | "repair" {
  return value === "minimal_patch" || value === "refactor" || value === "test_first" || value === "alternative" || value === "repair";
}

function parseAccessMode(value: unknown): AccessMode | undefined {
  if (value === undefined) return undefined;
  if (value === "restricted" || value === "partial" || value === "full") return value;
  throw new HttpError(400, "invalid_access_mode", "accessMode must be restricted, partial, or full.");
}

function parseRunMode(value: unknown): CockpitRunMode {
  if (value === undefined) return "auto";
  if (value === "auto" || value === "fixture" || value === "offline" || value === "live" || value === "council") return value;
  throw new HttpError(400, "invalid_run_mode", "runMode must be auto, fixture, offline, live, or council.");
}

function isMutatingMethod(method?: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function requireDestructiveConfirmation(url: URL, code: string, message: string): void {
  if (url.searchParams.get("confirmed") !== "true") {
    throw new HttpError(400, code, message);
  }
}

function parseExternalAgentRegistration(value: Record<string, unknown>): ExternalAgentRegistrationInput & { sessionId: string } {
  if (typeof value.id !== "string" || !value.id.trim()) throw new HttpError(400, "external_agent_id_required", "external agent registration requires id");
  const sessionId = parseRequiredSessionId(value.sessionId, "external agent registration requires sessionId");
  return {
    id: value.id,
    sessionId,
    name: typeof value.name === "string" ? value.name : value.id,
    transport: "mcp",
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.filter((item): item is string => typeof item === "string") : [],
    allowedRoles: Array.isArray(value.allowedRoles) ? value.allowedRoles.filter(isAgentRole) : [],
    trustLevel: value.trustLevel === "low" || value.trustLevel === "medium" || value.trustLevel === "high" || value.trustLevel === "owner" ? value.trustLevel : "medium",
    costProfile: typeof value.costProfile === "object" && value.costProfile !== null ? value.costProfile as Record<string, unknown> : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined
  };
}

function parseSetupRequest(value: Record<string, unknown>) {
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!provider) throw new HttpError(400, "provider_required", "provider is required.");
  if (!model) throw new HttpError(400, "model_required", "At least one model id is required.");
  return {
    provider,
    model,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl.trim() : undefined,
    apiKeyEnv: typeof value.apiKeyEnv === "string" ? value.apiKeyEnv.trim() : undefined,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined,
    requestTimeoutMs: parseOptionalPositiveInteger(value.requestTimeoutMs, "requestTimeoutMs"),
    maxRetries: parseOptionalNonNegativeInteger(value.maxRetries, "maxRetries"),
    bindRoles: Boolean(value.bindRoles)
  };
}

function parseProviderKeyRequest(provider: string, value: Record<string, unknown>) {
  const apiKey = typeof value.apiKey === "string" ? value.apiKey : "";
  const model = typeof value.model === "string" ? value.model.trim() : undefined;
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : undefined;
  const apiKeyEnv = typeof value.apiKeyEnv === "string" ? value.apiKeyEnv.trim() : undefined;
  return {
    provider,
    model,
    baseUrl,
    apiKeyEnv,
    apiKey,
    requestTimeoutMs: parseOptionalPositiveInteger(value.requestTimeoutMs, "requestTimeoutMs"),
    maxRetries: parseOptionalNonNegativeInteger(value.maxRetries, "maxRetries")
  };
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `invalid_${field}`, `${field} must be a positive integer.`);
  return parsed;
}

function parseOptionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, `invalid_${field}`, `${field} must be a non-negative integer.`);
  return parsed;
}

function parseLimitParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) throw new HttpError(400, "invalid_limit", "limit must be an integer from 1 to 50.");
  return parsed;
}

function parseRoleAssignmentsRequest(value: Record<string, unknown>) {
  if (!Array.isArray(value.assignments)) throw new HttpError(400, "assignments_required", "Role assignments array is required.");
  return {
    assignments: value.assignments.map((item) => {
      if (!item || typeof item !== "object") throw new HttpError(400, "invalid_assignment", "Each role assignment must be an object.");
      const record = item as Record<string, unknown>;
      const role = typeof record.role === "string" ? record.role.trim() : "";
      const provider = typeof record.provider === "string" ? record.provider.trim() : "";
      const model = typeof record.model === "string" ? record.model.trim() : "";
      if (!role || !provider || !model) throw new HttpError(400, "invalid_assignment", "Each role assignment requires role, provider, and model.");
      return { role, provider, model };
    })
  };
}

function parseApprovalIntent(value: Record<string, unknown>): CockpitApprovalIntent {
  const action = value.action;
  if (!["approve_patch", "reject_patch", "approve_shell", "reject_shell", "request_re_review", "undo_latest_patch"].includes(String(action))) {
    throw new HttpError(400, "invalid_approval_action", "approval intent requires a valid action");
  }
  const sessionId = parseRequiredSessionId(value.sessionId, "approval intent requires sessionId");
  return {
    action: action as CockpitApprovalIntent["action"],
    sessionId,
    approvalId: typeof value.approvalId === "string" ? value.approvalId : undefined,
    feedback: typeof value.feedback === "string" ? value.feedback : undefined
  };
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (agentRoles as readonly string[]).includes(value);
}

function parseRequiredSessionId(value: unknown, missingMessage: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "session_id_required", missingMessage);
  const sessionId = value.trim();
  if (!isSafeSessionId(sessionId)) throw new HttpError(400, "invalid_session_id", "Session id must contain only letters, numbers, underscores, or hyphens.");
  return sessionId;
}

async function loadRequiredSession(cwd: string, sessionId: string) {
  if (!isSafeSessionId(sessionId)) throw new HttpError(400, "invalid_session_id", "Session id must contain only letters, numbers, underscores, or hyphens.");
  try {
    return sessionId === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, sessionId);
  } catch {
    throw new HttpError(404, "session_not_found", `Session ${sessionId} was not found.`);
  }
}

async function resolveMutableSessionId(cwd: string, sessionId: string): Promise<string> {
  const session = await loadRequiredSession(cwd, sessionId);
  return session.sessionId;
}

async function sendCockpitShell(response: ServerResponse, nonce: string, webRoot?: string | false): Promise<void> {
  const root = await resolveCockpitWebRoot(webRoot);
  if (root) {
    const indexPath = safeStaticFilePath(root, "index.html");
    if (indexPath) {
      try {
        return sendCockpitHtml(response, await readFile(indexPath, "utf8"), nonce);
      } catch (error) {
        log("warn", `Falling back to embedded cockpit HTML because built index could not be read: ${error instanceof Error ? error.message : String(error)}`);
        // Fall back to the embedded client when a stale build directory is missing index.html.
      }
    }
  }
  return sendCockpitHtml(response, renderCockpitHtml(nonce), nonce);
}

function sendCockpitHtml(response: ServerResponse, html: string, nonce: string): void {
  const runtimeScript = `<script>window.__TOMORROWEDGE_COCKPIT__=${JSON.stringify({ nonce })};</script>`;
  const body = html.includes("</head>") ? html.replace("</head>", `${runtimeScript}</head>`) : `${runtimeScript}${html}`;
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "set-cookie": `tomorrowedge_nonce=${encodeURIComponent(nonce)}; Path=/api; SameSite=Strict; HttpOnly`
  });
  response.end(body);
}

async function sendCockpitAsset(response: ServerResponse, pathname: string, webRoot?: string | false): Promise<boolean> {
  const root = await resolveCockpitWebRoot(webRoot);
  if (!root) return false;
  const relativePath = pathname.replace(/^\/+/, "");
  const assetPath = safeStaticFilePath(root, relativePath);
  if (!assetPath) {
    sendJson(response, 400, { error: "invalid_static_asset" });
    return true;
  }
  try {
    const content = await readFile(assetPath);
    send(response, 200, content, contentTypeForStaticAsset(assetPath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log("warn", `Cockpit asset ${assetPath} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
}

async function resolveCockpitWebRoot(configured?: string | false): Promise<string | undefined> {
  if (configured === false) return undefined;
  const candidates = configured ? [configured] : [
    path.resolve(moduleDir, "..", "..", "dist", "cockpit-web"),
    path.resolve(moduleDir, "..", "cockpit-web")
  ];
  for (const candidate of candidates) {
    if (await isUsableCockpitWebRoot(candidate)) return candidate;
  }
  return undefined;
}

async function isUsableCockpitWebRoot(value: string): Promise<boolean> {
  try {
    if (!(await stat(value)).isDirectory()) return false;
    const indexHtml = await readFile(path.join(value, "index.html"), "utf8");
    if (indexHtml.includes('src="/src/') || indexHtml.includes("src='/src/")) return false;
    const assetRefs = extractStaticAssetRefs(indexHtml);
    const scriptRefs = assetRefs.filter((ref) => ref.endsWith(".js") || ref.endsWith(".mjs"));
    const styleRefs = assetRefs.filter((ref) => ref.endsWith(".css"));
    if (!scriptRefs.length || !styleRefs.length) return false;
    for (const ref of assetRefs) {
      const assetPath = safeStaticFilePath(value, ref.replace(/^\/+/, ""));
      if (!assetPath || !(await stat(assetPath)).isFile()) return false;
    }
    const styleContents = await Promise.all(styleRefs.map((ref) => readFile(path.join(value, ref.replace(/^\/+/, "")), "utf8")));
    return styleContents.some((content) => content.includes(".te-shell"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log("warn", `Cockpit web root ${value} is not usable: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
}

function extractStaticAssetRefs(indexHtml: string): string[] {
  return Array.from(indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))
    .map((match) => match[1])
    .filter((ref) => ref.startsWith("/assets/") || ref.startsWith("assets/"));
}

function safeStaticFilePath(root: string, ref: string): string | undefined {
  if (!ref || ref.includes("..") || path.isAbsolute(ref)) return undefined;
  const resolved = path.resolve(root, ref);
  const relative = path.relative(root, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : undefined;
}

function contentTypeForStaticAsset(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  if (ext === ".json" || ext === ".webmanifest" || ext === ".map") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

async function sendArtifact(cwd: string, response: ServerResponse, sessionId: string, ref: string): Promise<void> {
  if (!isSafeSessionId(sessionId) || !ref.startsWith("artifacts/") || ref.includes("..") || path.isAbsolute(ref)) {
    return sendJson(response, 400, { error: "invalid artifact ref" });
  }
  const effectiveSessionId = sessionId === "latest" ? (await loadLatestSession(cwd)).sessionId : sessionId;
  if (!isSafeSessionId(effectiveSessionId)) return sendJson(response, 400, { error: "invalid session id" });
  const sessionDir = path.resolve(cwd, ".tomorrowedge", "sessions", effectiveSessionId);
  const artifactPath = safeArtifactPath(sessionDir, ref);
  if (!artifactPath) return sendJson(response, 400, { error: "invalid artifact ref" });
  const content = redactText(await readFile(artifactPath, "utf8"));
  return send(response, 200, content, "text/plain; charset=utf-8");
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxJsonBodyBytes) throw new HttpError(413, "body_too_large", `JSON request body exceeds ${maxJsonBodyBytes} bytes.`);
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "invalid_json", "JSON request body must be an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

function isSafeSessionId(value: string): boolean {
  return value === "latest" || /^[A-Za-z0-9_-]+$/.test(value);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function sendLiveEvents(cwd: string, response: ServerResponse, sessionId: string): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-content-type-options": "nosniff"
  });
  const write = (event: string, data: unknown) => {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  write("ready", { sessionId });
  const snapshot = cockpitEventBus.getSnapshot(sessionId);
  if (snapshot) write("snapshot", { snapshot, viewModel: buildCockpitViewModel(cwd, snapshot.state, { source: "live", connectionState: "connected", stale: false }) });
  const unsubscribe = cockpitEventBus.subscribe(sessionId, (message) => {
    if (typeof message === "object" && message && "kind" in message) {
      const kind = String((message as { kind: string }).kind);
      const snapshotMessage = kind === "snapshot" ? message as unknown as { snapshot: { state: AgentGraphState } } : undefined;
      write(kind, snapshotMessage ? { ...message, viewModel: buildCockpitViewModel(cwd, snapshotMessage.snapshot.state, { source: "live", connectionState: "connected", stale: false }) } : message);
    }
  });
  response.on("close", unsubscribe);
}

function send(response: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}
