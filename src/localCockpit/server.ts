import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/configLoader.js";
import { runOfflineGraph, type OfflineGraphOptions } from "../core/agentGraph/executor.js";
import { loadLatestSession, loadSession, listSessions, saveSession } from "../core/memory/sessionMemory.js";
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
import type { CockpitApprovalIntent } from "../cockpit/contracts.js";
import { safeArtifactPath } from "../cockpit/artifacts.js";
import { executeCockpitApprovalAction } from "../cockpit/approvalExecutor.js";
import { buildAccessPolicy } from "../core/permissions/accessPolicy.js";
import type { AgentGraphState } from "../core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";

export type LocalCockpitServerOptions = {
  port?: number;
  host?: string;
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

export async function startLocalCockpitServer(cwd: string, options: LocalCockpitServerOptions = {}): Promise<LocalCockpitHandle> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 18792;
  const nonce = randomBytes(24).toString("base64url");
  const { server, port } = await listenOnAvailablePort(cwd, host, requestedPort, nonce);
  const url = `http://${host}:${port}`;
  return {
    server,
    url,
    openUrl: `${url}/?nonce=${encodeURIComponent(nonce)}`,
    nonce,
    requestedPort,
    port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function listenOnAvailablePort(cwd: string, host: string, requestedPort: number, nonce: string): Promise<{ server: Server; port: number }> {
  if (requestedPort === 0) return listenOnce(cwd, host, 0, nonce);
  const maxAttempts = 20;
  let lastError: unknown;
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = requestedPort + offset;
    try {
      return await listenOnce(cwd, host, port, nonce);
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No available port found starting at ${requestedPort}.`);
}

async function listenOnce(cwd: string, host: string, port: number, nonce: string): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    void routeRequest(cwd, request, response, nonce);
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

async function routeRequest(cwd: string, request: IncomingMessage, response: ServerResponse, nonce: string): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/cockpit")) {
      return send(response, 200, renderCockpitHtml(), "text/html; charset=utf-8");
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
    const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && sessionMatch) {
      const session = sessionMatch[1] === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, decodeURIComponent(sessionMatch[1]));
      return sendJson(response, 200, session);
    }
    const viewModelMatch = /^\/api\/sessions\/([^/]+)\/view-model$/.exec(url.pathname);
    if (request.method === "GET" && viewModelMatch) {
      const session = viewModelMatch[1] === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, decodeURIComponent(viewModelMatch[1]));
      return sendJson(response, 200, buildCockpitViewModel(cwd, session.state));
    }
    const eventsMatch = /^\/api\/sessions\/([^/]+)\/events$/.exec(url.pathname);
    if (request.method === "GET" && eventsMatch) {
      const session = eventsMatch[1] === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, decodeURIComponent(eventsMatch[1]));
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
      const config = loadConfig(cwd);
      const sessionId = `session_${randomBytes(8).toString("hex")}`;
      const goal = typeof body.goal === "string" && body.goal.trim() ? body.goal : "fix failing test";
      const accessMode = parseAccessMode(body.accessMode);
      const liveState = createLiveState(sessionId, goal, config, accessMode);
      const options: OfflineGraphOptions = {
        fixtureMode: body.fixtureMode !== false,
        accessMode,
        approvePatch: Boolean(body.approvePatch),
        approveShell: Boolean(body.approveShell),
        repairOnFail: Boolean(body.repairOnFail),
        approveRepair: Boolean(body.approveRepair),
        conversationTarget: typeof body.to === "string" ? body.to : "core",
        sessionId,
        onEvent: (event) => {
          applyLiveEvent(liveState, event);
          cockpitEventBus.emitEvent(sessionId, event);
          cockpitEventBus.setSnapshot({ sessionId, state: liveState, done: false });
        }
      };
      void runOfflineGraph(cwd, goal, config, options)
        .then(async (state) => {
          await saveSession(cwd, state);
          cockpitEventBus.setSnapshot({ sessionId: state.sessionId, state, done: true });
        })
        .catch((error) => {
          cockpitEventBus.setSnapshot({
            sessionId,
            state: {
              sessionId,
              goal,
              routing: { mode: config.routing.mode, privacyLocked: false, assignments: [], fallbacks: [] },
              access: { mode: options.accessMode ?? "partial", cloudAllowed: true, patchAllowed: false, shellAllowed: false, repairAllowed: false, patchApproved: false, shellApproved: false, repairApproved: false },
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
              budgetStatuses: [],
              changedFiles: [],
              runResults: [],
              approvals: { patchApproved: false, shellApproved: false, repairApproved: false }
            },
            done: true,
            error: error instanceof Error ? error.message : String(error)
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
      await saveSession(cwd, result.state);
      cockpitEventBus.setSnapshot({ sessionId: result.state.sessionId, state: result.state, done: false });
      return sendJson(response, 200, {
        status: "applied",
        intent,
        message: result.message,
        viewModel: buildCockpitViewModel(cwd, result.state)
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
  const viewModel = buildCockpitViewModel(cwd, state);
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

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
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

function applyLiveEvent(state: AgentGraphState, event: TomorrowEdgeEvent): void {
  state.events.push(event);
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

function isPatchApproach(value: string): value is "minimal_patch" | "refactor" | "test_first" | "alternative" | "repair" {
  return value === "minimal_patch" || value === "refactor" || value === "test_first" || value === "alternative" || value === "repair";
}

function parseAccessMode(value: unknown): AccessMode | undefined {
  if (value === undefined) return undefined;
  if (value === "restricted" || value === "partial" || value === "full") return value;
  throw new HttpError(400, "invalid_access_mode", "accessMode must be restricted, partial, or full.");
}

function isMutatingMethod(method?: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
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
  if (snapshot) write("snapshot", { snapshot, viewModel: buildCockpitViewModel(cwd, snapshot.state) });
  const unsubscribe = cockpitEventBus.subscribe(sessionId, (message) => {
    if (typeof message === "object" && message && "kind" in message) {
      const kind = String((message as { kind: string }).kind);
      const snapshotMessage = kind === "snapshot" ? message as unknown as { snapshot: { state: AgentGraphState } } : undefined;
      write(kind, snapshotMessage ? { ...message, viewModel: buildCockpitViewModel(cwd, snapshotMessage.snapshot.state) } : message);
    }
  });
  response.on("close", unsubscribe);
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}
