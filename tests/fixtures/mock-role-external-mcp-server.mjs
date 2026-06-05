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
    respond(request.id, { protocolVersion: "2024-11-05", serverInfo: { name: "mock-role-agent", version: "1.0.0" }, capabilities: { tools: {} } });
    return;
  }
  if (request.method === "tools/list") {
    respond(request.id, { tools: [{ name: "agent.run", description: "Mock role-aware external agent", inputSchema: { type: "object" } }] });
    return;
  }
  if (request.method === "tools/call") {
    const args = request.params?.arguments ?? {};
    respond(request.id, {
      content: [{ type: "text", text: `mock role response for ${args.role ?? "agent"}` }],
      structuredContent: structuredForRole(args.role, args.context ?? {})
    });
    return;
  }
  respond(request.id, null, { code: -32601, message: `unknown method ${request.method}` });
}

function structuredForRole(role, context) {
  if (process.env.TOMORROWEDGE_UNPARSEABLE_ROLE === role) {
    return { summary: `Unparseable fixture payload for ${role}.` };
  }
  if (role === "core") {
    return {
      summary: "External core planned the workflow.",
      plan: {
        goal: context.goal ?? "fix failing test",
        constraints: ["Use a minimal external-agent patch."],
        riskLevel: "low",
        taskType: "bugfix",
        steps: [{ id: "external_core_plan", title: "External core plan", detail: "Patch add() and verify with node test.js.", status: "pending" }],
        expectedFiles: ["index.js"],
        verificationCommands: ["node test.js"],
        debateRecommended: false
      }
    };
  }
  if (role === "coder_a") {
    return {
      summary: "External coder proposed the addition fix.",
      candidate: {
        candidateId: "external_codex_patch",
        agentId: "coder_a",
        approach: "minimal_patch",
        summary: "Change subtraction to addition.",
        filesChanged: ["index.js"],
        unifiedDiff: "--- a/index.js\n+++ b/index.js\n@@ -1,5 +1,5 @@\n export function add(a, b) {\n-  return a - b;\n+  return a + b;\n }\n \n export default add;\n",
        testPlan: ["node test.js"],
        knownTradeoffs: ["Fixture-only patch."],
        estimatedRisk: "low"
      }
    };
  }
  if (role === "reviewer") {
    return {
      summary: "External reviewer accepted the patch.",
      review: {
        mode: "standard",
        overallRecommendation: "External reviewer accepts the minimal patch.",
        reviews: [{
          candidateId: "external_codex_patch",
          correctnessScore: 96,
          riskScore: 5,
          invasiveness: "low",
          testCoverage: "adequate",
          securityConcerns: [],
          regressionConcerns: [],
          recommendation: "accept",
          notes: ["Diff targets index.js and includes verification."]
        }]
      }
    };
  }
  if (role === "judge") {
    return {
      summary: "External judge selected the accepted patch.",
      judgment: {
        decision: "select",
        selectedCandidateId: "external_codex_patch",
        reason: "External judge selected the reviewed minimal patch.",
        confidence: 0.91
      }
    };
  }
  return { summary: `No role fixture for ${role}.` };
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
