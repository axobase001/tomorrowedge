import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { TomorrowEdgeMcpBridge } from "../../src/mcp/bridge.js";
import { loadSession } from "../../src/core/memory/sessionMemory.js";
import { traceCommand } from "../../src/cli/commands/trace.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("MCP Agent Bridge", () => {
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
