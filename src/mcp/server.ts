import { TomorrowEdgeMcpBridge } from "./bridge.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

export type ServeMcpOptions = {
  cwd: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
};

export async function serveMcpStdio(options: ServeMcpOptions): Promise<void> {
  const bridge = new TomorrowEdgeMcpBridge(options.cwd);
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  let buffer = "";

  stdin.setEncoding("utf8");
  stdin.on("data", async (chunk: string) => {
    buffer += chunk;
    const messages = drainMessages(buffer);
    buffer = messages.rest;
    for (const raw of messages.items) {
      if (!raw.trim()) continue;
      await handleRawMessage(raw, bridge, stdout);
    }
  });
}

export async function handleMcpRequest(cwd: string, request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
  const bridge = new TomorrowEdgeMcpBridge(cwd);
  return handleRequest(request, bridge);
}

async function handleRawMessage(raw: string, bridge: TomorrowEdgeMcpBridge, stdout: NodeJS.WritableStream): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(raw) as JsonRpcRequest;
  } catch (error) {
    writeMessage(stdout, { jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
    return;
  }
  const response = await handleRequest(request, bridge);
  if (response) writeMessage(stdout, response);
}

async function handleRequest(request: JsonRpcRequest, bridge: TomorrowEdgeMcpBridge): Promise<JsonRpcResponse | undefined> {
  try {
    if (request.method === "notifications/initialized") return undefined;
    if (request.method === "initialize") {
      return ok(request.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "tomorrowedge", version: "0.3.0" },
        capabilities: { tools: {} }
      });
    }
    if (request.method === "tools/list") {
      return ok(request.id, { tools: bridge.listTools() });
    }
    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await bridge.callTool(name, args);
      return ok(request.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      });
    }
    return fail(request.id, -32601, `Unknown MCP method: ${request.method}`);
  } catch (error) {
    return fail(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function fail(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function writeMessage(stdout: NodeJS.WritableStream, response: JsonRpcResponse): void {
  stdout.write(`${JSON.stringify(response)}\n`);
}

function drainMessages(buffer: string): { items: string[]; rest: string } {
  const items: string[] = [];
  let rest = buffer;
  while (rest.length) {
    const framed = tryDrainContentLength(rest);
    if (framed) {
      items.push(framed.item);
      rest = framed.rest;
      continue;
    }
    const newline = rest.indexOf("\n");
    if (newline === -1) break;
    items.push(rest.slice(0, newline));
    rest = rest.slice(newline + 1);
  }
  return { items, rest };
}

function tryDrainContentLength(buffer: string): { item: string; rest: string } | undefined {
  const normalized = buffer.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("Content-Length:")) return undefined;
  const headerEnd = normalized.indexOf("\n\n");
  if (headerEnd === -1) return undefined;
  const header = normalized.slice(0, headerEnd);
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) return undefined;
  const length = Number(match[1]);
  const bodyStart = headerEnd + 2;
  if (normalized.length < bodyStart + length) return undefined;
  return {
    item: normalized.slice(bodyStart, bodyStart + length),
    rest: normalized.slice(bodyStart + length)
  };
}
