import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { buildAdvisoryPlans } from "../../src/core/model/modelAdvisory.js";
import { parseTaskGovernanceResponse } from "../../src/core/goal/taskGovernance.js";
import { buildRoleGraph } from "../../src/core/orchestration/roleGraph.js";
import { ModelRouter } from "../../src/core/routing/router.js";
import type { Plan } from "../../src/schemas/plan.js";

describe("task governance routing", () => {
  const analysisPlan: Plan = {
    goal: "Answer a correctness-critical reasoning request.",
    constraints: [],
    riskLevel: "low",
    taskType: "analysis",
    requiresPatchWorkflow: false,
    workflowKind: "advisory",
    steps: [{ id: "understand", title: "Understand", detail: "Understand the request.", status: "done" }],
    verificationCommands: [],
    debateRecommended: false
  };

  it("parses model semantic governance decisions without relying on native task types", () => {
    const decision = parseTaskGovernanceResponse(JSON.stringify({
      reasoningSensitivity: "high",
      requiresReviewer: true,
      requiresJudge: true,
      confidence: 0.91,
      reason: "The request needs independent correctness review before final delivery."
    }));

    expect(decision).toMatchObject({
      reasoningSensitivity: "high",
      requiresReviewer: true,
      requiresJudge: true
    });
  });

  it("adds reviewer and judge advisory calls when the model governance gate requires them", () => {
    const router = new ModelRouter(defaultConfig);
    const plans = buildAdvisoryPlans({
      cwd: process.cwd(),
      goal: analysisPlan.goal,
      config: defaultConfig,
      router,
      plan: analysisPlan,
      governance: {
        reasoningSensitivity: "high",
        requiresReviewer: true,
        requiresJudge: true,
        confidence: 0.91,
        reason: "Independent correctness review required.",
        provider: "mock",
        model: "mock-balanced"
      }
    });

    expect(plans.map((plan) => plan.role)).toEqual(["planner", "coder_a", "reviewer", "judge"]);
  });

  it("keeps governed advisory workflows read-only while exposing reviewer and judge nodes", () => {
    const graph = buildRoleGraph({ workflowKind: "advisory", highRisk: true });

    expect(graph.nodes.map((node) => node.role)).toEqual(["planner", "explorer", "reviewer", "judge", "summarizer"]);
    expect(graph.nodes.map((node) => node.role)).not.toContain("coder_a");
  });

  it("uses the semantic governance gate to upgrade correctness-critical advisory runs", async () => {
    const cwd = "tests/fixtures/sample-repo-basic";
    const state = await runOfflineGraph(cwd, "Prove every finite division ring is a field.", defaultConfig);
    const governanceEvent = state.events.find((event) => event.type === "task_governance");

    expect(state.workflowKind).toBe("advisory");
    expect(state.candidates).toEqual([]);
    expect(governanceEvent).toMatchObject({
      reasoningSensitivity: "high",
      requiresReviewer: true,
      requiresJudge: true
    });
    expect(state.roleGraph?.nodes.map((node) => node.role)).toEqual(expect.arrayContaining(["reviewer", "judge"]));
    expect(state.modelNotes.map((note) => note.kind)).toEqual(expect.arrayContaining(["review_advice", "judge_advice"]));
  });
});
