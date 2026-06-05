import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/configLoader.js";
import { runOfflineGraph, type OfflineGraphOptions } from "../core/agentGraph/executor.js";
import { loadLatestSession, loadSession, listSessions, saveSession } from "../core/memory/sessionMemory.js";
import { TomorrowEdgeMcpBridge } from "../mcp/bridge.js";
import { renderCockpitHtml } from "./html.js";
import type { AccessMode } from "../config/schema.js";
import type { ExternalAgentRegistrationInput } from "../core/externalAgents/externalAgentTypes.js";
import { agentRoles, type AgentRole } from "../schemas/agentTask.js";
import { redactText } from "../safety/secretScanner.js";

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
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "tomorrowedge-local-cockpit" });
    }
    if (url.pathname.startsWith("/api/") && !isAuthorized(request, url, nonce)) {
      return sendJson(response, 403, { error: "forbidden", message: "Missing or invalid local cockpit access token." });
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
    const eventsMatch = /^\/api\/sessions\/([^/]+)\/events$/.exec(url.pathname);
    if (request.method === "GET" && eventsMatch) {
      const session = eventsMatch[1] === "latest" ? await loadLatestSession(cwd) : await loadSession(cwd, decodeURIComponent(eventsMatch[1]));
      return sendJson(response, 200, session.state.events ?? []);
    }
    const artifactMatch = /^\/api\/sessions\/([^/]+)\/artifacts\/(.+)$/.exec(url.pathname);
    if (request.method === "GET" && artifactMatch) {
      return sendArtifact(cwd, response, decodeURIComponent(artifactMatch[1]), decodeURIComponent(artifactMatch[2]));
    }
    if (request.method === "POST" && url.pathname === "/api/runs") {
      const body = await readJsonBody(request);
      const config = loadConfig(cwd);
      const options: OfflineGraphOptions = {
        fixtureMode: body.fixtureMode !== false,
        accessMode: parseAccessMode(body.accessMode),
        approvePatch: Boolean(body.approvePatch),
        approveShell: Boolean(body.approveShell),
        repairOnFail: Boolean(body.repairOnFail),
        approveRepair: Boolean(body.approveRepair),
        conversationTarget: typeof body.to === "string" ? body.to : "core"
      };
      const state = await runOfflineGraph(cwd, typeof body.goal === "string" && body.goal.trim() ? body.goal : "fix failing test", config, options);
      await saveSession(cwd, state);
      return sendJson(response, 200, { sessionId: state.sessionId, state });
    }
    if (request.method === "POST" && url.pathname === "/api/mcp/register") {
      const body = await readJsonBody(request);
      const bridge = new TomorrowEdgeMcpBridge(cwd);
      const result = await bridge.registerExternalAgent(parseExternalAgentRegistration(body));
      return sendJson(response, 200, result);
    }
    return sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) return sendJson(response, error.status, { error: error.code, message: error.message });
    return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function isAuthorized(request: IncomingMessage, url: URL, nonce: string): boolean {
  const provided = request.headers["x-tomorrowedge-token"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("nonce") ?? "";
  const presented = Array.isArray(provided) ? provided[0] : provided;
  if (!presented || presented.length !== nonce.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(nonce));
}

function parseAccessMode(value: unknown): AccessMode | undefined {
  return value === "restricted" || value === "partial" || value === "full" ? value : undefined;
}

function parseExternalAgentRegistration(value: Record<string, unknown>): ExternalAgentRegistrationInput {
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error("external agent registration requires id");
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    transport: "mcp",
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.filter((item): item is string => typeof item === "string") : [],
    allowedRoles: Array.isArray(value.allowedRoles) ? value.allowedRoles.filter(isAgentRole) : [],
    trustLevel: value.trustLevel === "low" || value.trustLevel === "medium" || value.trustLevel === "high" || value.trustLevel === "owner" ? value.trustLevel : "medium",
    costProfile: typeof value.costProfile === "object" && value.costProfile !== null ? value.costProfile as Record<string, unknown> : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined
  };
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (agentRoles as readonly string[]).includes(value);
}

async function sendArtifact(cwd: string, response: ServerResponse, sessionId: string, ref: string): Promise<void> {
  if (!isSafeSessionId(sessionId) || ref.includes("..") || path.isAbsolute(ref)) {
    return sendJson(response, 400, { error: "invalid artifact ref" });
  }
  const effectiveSessionId = sessionId === "latest" ? (await loadLatestSession(cwd)).sessionId : sessionId;
  if (!isSafeSessionId(effectiveSessionId)) return sendJson(response, 400, { error: "invalid session id" });
  const sessionDir = path.resolve(cwd, ".tomorrowedge", "sessions", effectiveSessionId);
  const artifactPath = path.resolve(sessionDir, ref);
  if (!isPathInside(sessionDir, artifactPath)) return sendJson(response, 400, { error: "invalid artifact ref" });
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
  return JSON.parse(text) as Record<string, unknown>;
}

function isSafeSessionId(value: string): boolean {
  return value === "latest" || /^[A-Za-z0-9_-]+$/.test(value);
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}
