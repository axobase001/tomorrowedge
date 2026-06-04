let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.length) {
    const message = drain(buffer);
    if (!message) break;
    buffer = message.rest;
    handle(JSON.parse(message.item));
  }
});

function handle(request) {
  if (request.method === "initialize") {
    respond(request.id, { protocolVersion: "2024-11-05", serverInfo: { name: "mock-external-agent", version: "1.0.0" }, capabilities: { tools: {} } });
    return;
  }
  if (request.method === "tools/list") {
    respond(request.id, {
      tools: [
        {
          name: "agent.run",
          description: "Mock external coding agent",
          inputSchema: { type: "object" }
        }
      ]
    });
    return;
  }
  if (request.method === "tools/call") {
    respond(request.id, {
      content: [{ type: "text", text: `mock external response for ${request.params?.arguments?.role ?? "agent"}` }],
      structuredContent: { ok: true, seenPrompt: Boolean(request.params?.arguments?.prompt) }
    });
    return;
  }
  respond(request.id, null, { code: -32601, message: `unknown method ${request.method}` });
}

function respond(id, result, error) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result, error });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function drain(text) {
  const headerEnd = text.indexOf("\r\n\r\n") >= 0 ? text.indexOf("\r\n\r\n") : text.indexOf("\n\n");
  if (headerEnd === -1) return undefined;
  const header = text.slice(0, headerEnd);
  const match = /content-length:\s*(\d+)/i.exec(header);
  if (!match) return undefined;
  const separatorLength = text.slice(headerEnd, headerEnd + 4) === "\r\n\r\n" ? 4 : 2;
  const bodyStart = headerEnd + separatorLength;
  const length = Number(match[1]);
  if (text.length < bodyStart + length) return undefined;
  return { item: text.slice(bodyStart, bodyStart + length), rest: text.slice(bodyStart + length) };
}
