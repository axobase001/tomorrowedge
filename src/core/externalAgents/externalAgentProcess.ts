import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { diagnoseExternalAgentProfile, formatExternalAgentDiagnostic, resolveExternalAgentWorkingDirectory } from "./externalAgentDiagnostics.js";
import type { ExternalAgentProfile } from "./externalAgentTypes.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../../package.json") as { version: string };

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

export type ExternalAgentProcessResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  attempts: number;
};

export type ExternalAgentTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export class ExternalAgentProcessClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = "";
  private readonly framing: "content-length" | "newline";
  private readonly pending = new Map<number, { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly profile: ExternalAgentProfile, private readonly cwd: string) {
    this.framing = isCodexCommand(profile.command) ? "newline" : "content-length";
  }

  async start(): Promise<void> {
    if (this.child) return;
    const diagnostic = diagnoseExternalAgentProfile(this.profile, this.cwd);
    if (diagnostic.status === "error") {
      throw new Error(`External agent ${this.profile.id} is not invokable: ${formatExternalAgentDiagnostic(diagnostic)}`);
    }
    if (!this.profile.command) {
      throw new Error(`External agent ${this.profile.id} has no command configured.`);
    }
    this.child = spawn(this.profile.command, this.profile.args ?? [], {
      cwd: resolveExternalAgentWorkingDirectory(this.profile, this.cwd),
      env: buildExternalAgentEnv(this.profile),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.on("exit", (code, signal) => {
      const error = new Error(`External agent ${this.profile.id} exited code=${code ?? "null"} signal=${signal ?? "null"}.`);
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(error);
      }
      this.pending.clear();
      this.child = undefined;
    });
    await this.initialize();
  }

  async initialize(): Promise<ExternalAgentProcessResult> {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tomorrowedge", version: packageJson.version }
    }, this.profile.startupTimeoutMs ?? this.profile.requestTimeoutMs ?? 60_000);
    return response;
  }

  async listTools(): Promise<ExternalAgentTool[]> {
    const response = await this.request("tools/list", {});
    if (!response.ok) throw new Error(response.error ?? `External agent ${this.profile.id} tools/list failed.`);
    const payload = response.result as { tools?: ExternalAgentTool[] };
    return payload.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ExternalAgentProcessResult> {
    return this.request("tools/call", { name, arguments: args });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    child.kill();
  }

  private async request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<ExternalAgentProcessResult> {
    const maxRetries = this.profile.maxRetries ?? 1;
    let lastError = "";
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const response = await this.send({ jsonrpc: "2.0", id: this.nextId++, method, params }, timeoutMs);
        if (response.error) {
          lastError = response.error.message ?? `JSON-RPC error ${response.error.code ?? ""}`.trim();
        } else {
          return { ok: true, result: response.result, attempts: attempt };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return { ok: false, error: lastError || `${method} failed`, attempts: maxRetries + 1 };
  }

  private send(request: JsonRpcRequest, timeoutMs?: number): Promise<JsonRpcResponse> {
    if (!this.child) throw new Error(`External agent ${this.profile.id} is not running.`);
    const timeout = timeoutMs ?? this.profile.requestTimeoutMs ?? 60_000;
    const body = JSON.stringify(request);
    const framed = this.framing === "newline" ? `${body}\n` : `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`External agent ${this.profile.id} timed out on ${request.method}.`));
      }, timeout);
      this.pending.set(request.id, { resolve, reject, timer });
      this.child!.stdin.write(framed);
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (this.buffer.length) {
      const framed = drainContentLength(this.buffer);
      if (framed) {
        this.buffer = framed.rest;
        this.resolveMessage(framed.item);
        continue;
      }
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.resolveMessage(line);
    }
  }

  private resolveMessage(raw: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const item = this.pending.get(message.id);
    if (!item) return;
    this.pending.delete(message.id);
    clearTimeout(item.timer);
    item.resolve(message);
  }
}

export function buildExternalAgentEnv(profile: ExternalAgentProfile, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const proxyEnv = profile.proxyPort ? proxyEnvForPort(profile.proxyPort) : {};
  return { ...baseEnv, ...proxyEnv, ...(profile.env ?? {}) };
}

export async function probeExternalAgent(profile: ExternalAgentProfile, cwd: string): Promise<{ ok: boolean; detail: string; tools?: ExternalAgentTool[] }> {
  const diagnostic = diagnoseExternalAgentProfile(profile, cwd);
  if (diagnostic.status === "error" || !profile.command) {
    return { ok: false, detail: formatExternalAgentDiagnostic(diagnostic) };
  }
  const client = new ExternalAgentProcessClient(profile, cwd);
  try {
    await client.start();
    const tools = await client.listTools();
    return { ok: true, detail: `${tools.length} tool(s) available`, tools };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.stop();
  }
}

function proxyEnvForPort(port: number): Record<string, string> {
  const proxyUrl = `http://127.0.0.1:${port}`;
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl
  };
}

export function isCodexCommand(command?: string): boolean {
  const name = command?.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return /^codex(?:\.(?:exe|cmd|bat|ps1))?$/.test(name);
}

function drainContentLength(buffer: string): { item: string; rest: string } | undefined {
  const headerEnd = buffer.indexOf("\r\n\r\n") >= 0 ? buffer.indexOf("\r\n\r\n") : buffer.indexOf("\n\n");
  if (headerEnd === -1 || !buffer.slice(0, headerEnd).toLowerCase().includes("content-length:")) return undefined;
  const header = buffer.slice(0, headerEnd);
  const match = /content-length:\s*(\d+)/i.exec(header);
  if (!match) return undefined;
  const separatorLength = buffer.slice(headerEnd, headerEnd + 4) === "\r\n\r\n" ? 4 : 2;
  const bodyStart = headerEnd + separatorLength;
  const length = Number(match[1]);
  if (buffer.length < bodyStart + length) return undefined;
  return { item: buffer.slice(bodyStart, bodyStart + length), rest: buffer.slice(bodyStart + length) };
}
