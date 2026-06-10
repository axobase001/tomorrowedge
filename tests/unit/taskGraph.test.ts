import { describe, expect, it } from "vitest";
import { contractToPlan } from "../../src/core/contracts/contractToPlan.js";
import { generateNativeObjectiveContract } from "../../src/core/contracts/contractGenerator.js";
import { buildTaskGraph } from "../../src/core/planning/taskGraphBuilder.js";
import { validateTaskGraph } from "../../src/core/planning/taskGraphValidator.js";
import { parseGoalToPlan } from "../../src/core/goal/goalParser.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { classifyWorkflowIntentLocally } from "../../src/core/goal/workflowIntent.js";
import { profileScenario } from "../../src/core/scenarios/scenarioProfiler.js";

describe("task graph planner layer", () => {
  it("builds a valid task graph from the native planner", () => {
    const plan = parseGoalToPlan("fix the failing test and verify it");

    expect(plan.taskGraph).toBeTruthy();
    expect(validateTaskGraph(plan.taskGraph!).ok).toBe(true);
    expect(plan.taskGraph?.nodes.some((node) => node.roleHints.includes("coder_a"))).toBe(true);
  });

  it("adds governance nodes for high-risk contracts", () => {
    const workflowIntent = classifyWorkflowIntentLocally("fix auth token handling bug");
    const scenarioProfile = profileScenario({ goal: "fix auth token handling bug", workflowIntent: { ...workflowIntent, provider: "test", model: "local" }, accessMode: "partial" });
    const contract = {
      ...generateNativeObjectiveContract({
        goal: "fix auth token handling bug",
        workflowIntent: { ...workflowIntent, provider: "test", model: "local" },
        scenarioProfile,
        retrievedTraces: [],
        config: defaultConfig,
        accessMode: "partial"
      }),
      riskLevel: "high" as const
    };
    const plan = contractToPlan(contract);
    const graph = buildTaskGraph({ plan, contract });

    expect(validateTaskGraph(graph).ok).toBe(true);
    expect(graph.nodes.map((node) => node.roleHints[0])).toEqual(expect.arrayContaining(["reviewer", "judge"]));
  });

  it("keeps read-only task graphs out of coder and runner phases", () => {
    const plan = parseGoalToPlan("inspect README and summarize without editing files");

    expect(plan.taskType).toBe("analysis");
    expect(plan.taskGraph?.nodes.flatMap((node) => node.roleHints)).not.toContain("coder_a");
    expect(plan.taskGraph?.nodes.flatMap((node) => node.roleHints)).not.toContain("runner");
  });
});
