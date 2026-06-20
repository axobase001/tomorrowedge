import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { writeConfig } from "../../src/config/configLoader.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { mcpTools, TomorrowEdgeMcpBridge } from "../../src/mcp/bridge.js";
import { serveMcpStdio } from "../../src/mcp/server.js";
import { loadSession } from "../../src/core/memory/sessionMemory.js";
import { traceCommand } from "../../src/cli/commands/trace.js";
import { mcpAgentsCommand } from "../../src/cli/commands/mcp.js";
import { ModelRouter } from "../../src/core/routing/router.js";
import { ExternalAgentProcessClient } from "../../src/core/externalAgents/externalAgentProcess.js";

describe("MCP Agent Bridge", () => {
  it("exposes narrow schemas for role-bound external agent tools", () => {
    const byName = new Map(mcpTools.map((tool) => [tool.name, tool.inputSchema]));
    const registerSchema = byName.get("tomorrowedge.register_external_agent") as JsonSchemaObject;
    const patchSchema = byName.get("tomorrowedge.propose_patch") as JsonSchemaObject;
    const reviewSchema = byName.get("tomorrowedge.submit_review") as JsonSchemaObject;
    const judgmentSchema = byName.get("tomorrowedge.submit_judgment") as JsonSchemaObject;

    expect(patchSchema.additionalProperties).toBe(false);
    expect(reviewSchema.additionalProperties).toBe(false);
    expect(judgmentSchema.additionalProperties).toBe(false);
    expect((patchSchema.properties.role as JsonSchemaObject).enum).toEqual(expect.arrayContaining(["planner", "reviewer", "judge", "coder_a"]));
    expect((registerSchema.properties.trustLevel as JsonSchemaObject).enum).toEqual(["low", "medium", "high", "owner"]);
    expect(((patchSchema.properties.candidate as JsonSchemaObject).properties.estimatedRisk as JsonSchemaObject).enum).toEqual(["low", "medium", "high"]);
    expect(((reviewSchema.properties.review as JsonSchemaObject).properties.mode as JsonSchemaObject).enum).toEqual(["standard", "red_team"]);
    expect(((judgmentSchema.properties.judgment as JsonSchemaObject).properties.decision as JsonSchemaObject).enum).toEqual(["select", "request_revision", "ask_user", "abort"]);
  });

  it("serves MCP tools over stdio in mock mode", async () => {
    const input = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    ].join("\n") + "\n";

    const result = await execa("tsx", ["src/cli/index.ts", "mcp", "serve"], {
      cwd: process.cwd(),
      preferLocal: true,
      input,
      timeout: 15_000
    });

    expect(result.stdout).toContain("tomorrowedge.start_workflow");
    expect(result.stdout).toContain("tomorrowedge.submit_judgment");
  }, 20_000);

  it("handles a full JSON-RPC tools/call workflow over stdio", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-mcp-jsonrpc-"));
    await writeConfig(cwd, {
      ...defaultConfig,
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true
        }
      }
    });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const rpc = createJsonRpcHarness(stdout);
    await serveMcpStdio({ cwd, stdin, stdout });
    try {
      const initialized = await rpc.send(stdin, 1, "initialize", {});
      expect(initialized.result?.serverInfo?.name).toBe("tomorrowedge");

      const started = structured(await rpc.send(stdin, 2, "tools/call", {
        name: "tomorrowedge.start_workflow",
        arguments: { goal: "mcp json-rpc patch review judgment smoke", accessMode: "partial" }
      })) as { sessionId: string };

      await rpc.send(stdin, 3, "tools/call", {
        name: "tomorrowedge.propose_patch",
        arguments: {
          sessionId: started.sessionId,
          externalAgentId: "codex",
          role: "coder_a",
          candidate: {
            candidateId: "rpc_patch_1",
            summary: "Use addition instead of subtraction.",
            filesChanged: ["index.js"],
            unifiedDiff: "--- a/index.js\n+++ b/index.js\n@@ -1,3 +1,3 @@\n- return a - b;\n+ return a + b;\n",
            estimatedRisk: "low",
            testPlan: ["npm test"]
          }
        }
      });
      await rpc.send(stdin, 4, "tools/call", {
        name: "tomorrowedge.submit_review",
        arguments: {
          sessionId: started.sessionId,
          externalAgentId: "codex",
          review: {
            overallRecommendation: "RPC review accepts the patch.",
            reviews: [
              {
                candidateId: "rpc_patch_1",
                correctnessScore: 92,
                riskScore: 8,
                invasiveness: "low",
                testCoverage: "adequate",
                securityConcerns: [],
                regressionConcerns: [],
                redTeamFindings: [],
                recommendation: "accept",
                notes: ["JSON-RPC review submitted."]
              }
            ]
          }
        }
      });
      await rpc.send(stdin, 5, "tools/call", {
        name: "tomorrowedge.submit_judgment",
        arguments: {
          sessionId: started.sessionId,
          externalAgentId: "codex",
          judgment: {
            decision: "select",
            selectedCandidateId: "rpc_patch_1",
            reason: "RPC judge selected the reviewed patch.",
            confidence: 0.9
          }
        }
      });

      const trace = structured(await rpc.send(stdin, 6, "tools/call", {
        name: "tomorrowedge.get_trace",
        arguments: { sessionId: started.sessionId }
      })) as { events: Array<{ type: string }>; markdown: string };
      expect(trace.events.map((event) => event.type)).toEqual(expect.arrayContaining(["patch_candidate", "review_decision", "judge_decision"]));
      expect(trace.markdown).toContain("rpc_patch_1");

      const exported = structured(await rpc.send(stdin, 7, "tools/call", {
        name: "tomorrowedge.export_session",
        arguments: { sessionId: started.sessionId, format: "markdown" }
      })) as { format: string; content: string };
      expect(exported.format).toBe("markdown");
      expect(exported.content).toContain("## Routing");
      expect(exported.content).toContain("## Patches");
      expect(exported.content).toContain("rpc_patch_1");
      expect(exported.content).toContain("- return a - b;");
      expect(exported.content).toContain("+ return a + b;");
      expect(exported.content).toContain("RPC judge selected the reviewed patch.");

      const exportedJson = structured(await rpc.send(stdin, 8, "tools/call", {
        name: "tomorrowedge.export_session",
        arguments: { sessionId: started.sessionId, format: "json", includeArtifacts: true }
      })) as { format: string; content: string };
      const parsedExport = JSON.parse(exportedJson.content) as { artifacts?: Record<string, string> };
      expect(Object.values(parsedExport.artifacts ?? {}).join("\n")).toContain("- return a - b;");
      expect(Object.values(parsedExport.artifacts ?? {}).join("\n")).toContain("+ return a + b;");
      expect(Object.values(parsedExport.artifacts ?? {}).join("\n")).not.toContain("[stored in artifact file]");
    } finally {
      rpc.dispose();
      stdin.destroy();
      stdout.destroy();
    }
  }, 20_000);

  it("binds enabled external agents to planner reviewer and judge roles", () => {
    const router = new ModelRouter(externalConfig());

    expect(router.assignmentFor("planner")).toMatchObject({ provider: "external:claude_code", model: "Claude Code" });
    expect(router.assignmentFor("reviewer")).toMatchObject({ provider: "external:codex", model: "Codex" });
    expect(router.assignmentFor("judge")).toMatchObject({ provider: "external:claude_code", model: "Claude Code" });
  });

  it("records external agent patch review judgment and trace events", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-mcp-"));
    const bridge = new TomorrowEdgeMcpBridge(cwd, externalConfig());
    const started = await bridge.startWorkflow({ goal: "fix failing test", accessMode: "partial" });

    await bridge.registerExternalAgent({
      sessionId: started.sessionId,
      id: "claude_code",
      name: "Claude Code",
      capabilities: ["planning", "review", "judgment"],
      allowedRoles: ["planner", "reviewer", "judge"],
      trustLevel: "high"
    });

    const patch = await bridge.proposePatch({
      sessionId: started.sessionId,
      externalAgentId: "codex",
      role: "coder_a",
      candidate: {
        candidateId: "codex_patch_1",
        summary: "Use addition instead of subtraction.",
        filesChanged: ["index.js"],
        unifiedDiff: "--- a/index.js\n+++ b/index.js\n@@ -1,3 +1,3 @@\n- return a - b;\n+ return a + b;\n",
        estimatedRisk: "low",
        testPlan: ["npm test"]
      }
    });
    await bridge.submitReview({
      sessionId: started.sessionId,
      externalAgentId: "codex",
      review: {
        overallRecommendation: "Accept external patch after test.",
        reviews: [
          {
            candidateId: patch.candidate.candidateId,
            correctnessScore: 90,
            riskScore: 10,
            invasiveness: "low",
            testCoverage: "adequate",
            securityConcerns: [],
            regressionConcerns: [],
            redTeamFindings: [],
            recommendation: "accept",
            notes: ["External review via MCP."]
          }
        ]
      }
    });
    await bridge.submitJudgment({
      sessionId: started.sessionId,
      externalAgentId: "claude_code",
      judgment: {
        decision: "select",
        selectedCandidateId: patch.candidate.candidateId,
        reason: "External judge selected the Codex patch.",
        confidence: 0.82
      }
    });
    await bridge.submitAgentResult({
      sessionId: started.sessionId,
      externalAgentId: "claude_code",
      role: "planner",
      summary: "Planner handoff complete.",
      result: { next: "review patch" },
      usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001 }
    });

    const session = await loadSession(cwd, started.sessionId);
    expect(session.state.candidates).toHaveLength(1);
    expect(session.state.review?.overallRecommendation).toContain("Accept external patch");
    expect(session.state.judge?.selectedCandidateId).toBe("codex_patch_1");
    expect(session.state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "external_agent_registered",
      "external_agent_call",
      "external_agent_patch_candidate",
      "external_agent_review",
      "external_agent_judgment",
      "external_agent_result",
      "external_agent_cost_usage"
    ]));

    const output = await captureStdout(() => traceCommand(cwd, "latest", { verbose: true }));
    expect(output).toContain("claude_code");
    expect(output).toContain("codex_patch_1");
  });

  it("can invoke a configured external MCP stdio process", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-mcp-process-"));
    const config = externalConfig();
    config.external_agents.codex = {
      ...config.external_agents.codex,
      enabled: true,
      command: process.execPath,
      args: [path.join(process.cwd(), "tests", "fixtures", "mock-external-mcp-server.mjs")],
      autoStart: true,
      requestTimeoutMs: 10_000
    };
    const bridge = new TomorrowEdgeMcpBridge(cwd, config);
    const started = await bridge.startWorkflow({ goal: "external process smoke" });
    const result = await bridge.invokeExternalAgent({
      sessionId: started.sessionId,
      externalAgentId: "codex",
      role: "reviewer",
      prompt: "review this workflow"
    });

    expect(JSON.stringify(result.result)).toContain("mock external response");
    const session = await loadSession(cwd, started.sessionId);
    expect(session.state.events.map((event) => event.type)).toEqual(expect.arrayContaining(["external_agent_call", "external_agent_result"]));
  });

  it("can invoke a configured external command runner process", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-mcp-command-runner-"));
    const config = externalConfig();
    config.external_agents.codex = {
      ...config.external_agents.codex,
      enabled: true,
      command: process.execPath,
      args: [path.join(process.cwd(), "tests", "fixtures", "mock-command-agent.mjs")],
      autoStart: false,
      requestTimeoutMs: 10_000
    };
    const bridge = new TomorrowEdgeMcpBridge(cwd, config);
    const started = await bridge.startWorkflow({ goal: "external command runner smoke" });
    const result = await bridge.invokeExternalAgent({
      sessionId: started.sessionId,
      externalAgentId: "codex",
      role: "reviewer",
      prompt: "review this workflow through command runner"
    });

    expect(JSON.stringify(result.result)).toContain("mock command handled reviewer");
    const session = await loadSession(cwd, started.sessionId);
    expect(session.state.events.map((event) => event.type)).toEqual(expect.arrayContaining(["external_agent_call", "external_agent_result"]));
    expect(JSON.stringify(session.state.events)).toContain("external_agent_response");
  });

  it("probes configured external MCP stdio tools", async () => {
    const profile = {
      id: "codex",
      name: "Codex",
      transport: "mcp" as const,
      command: process.execPath,
      args: [path.join(process.cwd(), "tests", "fixtures", "mock-external-mcp-server.mjs")],
      autoStart: true,
      requestTimeoutMs: 10_000,
      capabilities: ["review"],
      allowedRoles: ["reviewer" as const],
      trustLevel: "high" as const
    };
    const client = new ExternalAgentProcessClient(profile, process.cwd());
    await client.start();
    const tools = await client.listTools();
    await client.stop();
    expect(tools.map((tool) => tool.name)).toContain("agent.run");
  });

  it("prints external agent diagnostics without spawning processes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-mcp-diagnose-"));
    await writeConfig(cwd, {
      ...defaultConfig,
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-external-mcp-server.mjs")],
          autoStart: true,
          roles: ["reviewer"],
          capabilities: ["review"]
        },
        claude_code: {
          ...defaultConfig.external_agents.claude_code,
          enabled: true,
          command: "",
          roles: ["planner"],
          capabilities: ["planning"]
        }
      }
    });

    const output = await captureStdout(() => mcpAgentsCommand(cwd, { diagnose: true }));

    expect(output).toContain("codex\tCodex\tready\tmode=stdio_mcp");
    expect(output).toContain("command found");
    expect(output).toContain("claude_code\tClaude Code\twarning\tmode=manual_bridge");
    expect(output).toContain("command not configured");
  });
});

function externalConfig(): TomorrowEdgeConfig {
  return {
    ...defaultConfig,
    external_agents: {
      claude_code: {
        enabled: true,
        name: "Claude Code",
        transport: "mcp",
        capabilities: ["core", "planning", "review", "judgment"],
        roles: ["core", "planner", "reviewer", "judge"],
        trustLevel: "high"
      },
      codex: {
        enabled: true,
        name: "Codex",
        transport: "mcp",
        capabilities: ["core", "coding", "repair", "review"],
        roles: ["core", "coder_a", "repairer", "reviewer"],
        trustLevel: "high"
      }
    },
    agents: {
      ...defaultConfig.agents,
      planner: { provider: "external:claude_code", model: "auto" },
      reviewer: { provider: "external:codex", model: "auto" },
      judge: { provider: "external:claude_code", model: "auto" }
    }
  };
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return output;
}

type RpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: {
    serverInfo?: { name?: string };
    structuredContent?: unknown;
  };
  error?: { message: string };
};

function structured(response: RpcResponse): unknown {
  expect(response.error).toBeUndefined();
  expect(response.result).toBeTruthy();
  return response.result?.structuredContent;
}

function createJsonRpcHarness(stdout: PassThrough): {
  send(stdin: PassThrough, id: number, method: string, params: Record<string, unknown>): Promise<RpcResponse>;
  dispose(): void;
} {
  type Pending = {
    resolve: (value: RpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  };
  const pending = new Map<number, Pending>();
  let buffer = "";
  const onData = (chunk: Buffer | string) => {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const response = JSON.parse(line) as RpcResponse;
      const waiter = pending.get(response.id);
      if (!waiter) continue;
      pending.delete(response.id);
      clearTimeout(waiter.timeout);
      waiter.resolve(response);
    }
  };
  stdout.on("data", onData);
  return {
    send(stdin, id, method, params) {
      return new Promise<RpcResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for JSON-RPC response ${id}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timeout });
        stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    dispose() {
      stdout.off("data", onData);
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("JSON-RPC harness disposed."));
      }
      pending.clear();
    }
  };
}

type JsonSchemaObject = {
  additionalProperties?: boolean;
  enum?: string[];
  properties: Record<string, unknown>;
};
