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
    expect(plan.taskGraph?.schemaVersion).toBe("task-graph/v1");
    expect(plan.taskGraph?.nodes.some((node) => node.ownerRole === "coder_a" && node.kind === "patch")).toBe(true);
    expect(plan.taskGraph?.nodes.find((node) => node.id === "apply_patch")?.dependsOn).toContain("judge_patch");
    expect(plan.taskGraph?.nodes.find((node) => node.id === "verify_patch")?.dependsOn).toContain("apply_patch");
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
    expect(graph.nodes.map((node) => node.ownerRole)).toEqual(expect.arrayContaining(["reviewer", "judge"]));
    expect(graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["risk_map", "security_review", "judge_patch"]));
  });

  it("keeps read-only task graphs out of coder and runner phases", () => {
    const plan = parseGoalToPlan("inspect README and summarize without editing files");

    expect(plan.taskType).toBe("analysis");
    expect(plan.taskGraph?.nodes.flatMap((node) => node.roleHints)).not.toContain("coder_a");
    expect(plan.taskGraph?.nodes.flatMap((node) => node.roleHints)).not.toContain("runner");
    expect(plan.taskGraph?.nodes.some((node) => node.mutationAllowed)).toBe(false);
  });

  it("rejects read-only graphs with mutation nodes", () => {
    const plan = parseGoalToPlan("inspect README and summarize without editing files");
    const graph = {
      ...plan.taskGraph!,
      nodes: [
        ...plan.taskGraph!.nodes,
        {
          ...plan.taskGraph!.nodes[0]!,
          id: "bad_patch",
          kind: "patch" as const,
          ownerRole: "coder_a" as const,
          roleHints: ["coder_a" as const],
          mutationAllowed: true,
          dependsOn: ["inspect_context"],
          dependencies: ["inspect_context"]
        }
      ]
    };

    expect(validateTaskGraph(graph).ok).toBe(false);
    expect(validateTaskGraph(graph).errors.join("\n")).toContain("read-only graph");
  });

  it("rejects patch graphs where apply does not depend on judge", () => {
    const plan = parseGoalToPlan("fix the failing test and verify it");
    const graph = {
      ...plan.taskGraph!,
      nodes: plan.taskGraph!.nodes.map((node) => node.id === "apply_patch"
        ? { ...node, dependsOn: ["produce_patch"], dependencies: ["produce_patch"] }
        : node)
    };

    expect(validateTaskGraph(graph).ok).toBe(false);
    expect(validateTaskGraph(graph).errors.join("\n")).toContain("apply_patch must depend on judge");
  });
});
