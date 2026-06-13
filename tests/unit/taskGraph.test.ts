import { describe, expect, it } from "vitest";
import { contractToPlan } from "../../src/core/contracts/contractToPlan.js";
import { generateNativeObjectiveContract } from "../../src/core/contracts/contractGenerator.js";
import { buildTaskGraph } from "../../src/core/planning/taskGraphBuilder.js";
import { validateTaskGraph } from "../../src/core/planning/taskGraphValidator.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { WorkflowIntentDecision } from "../../src/core/goal/workflowIntent.js";
import type { ScenarioProfile } from "../../src/core/scenarios/scenarioTypes.js";
import type { Plan } from "../../src/schemas/plan.js";

describe("task graph planner layer", () => {
  it("builds a valid task graph from a model-backed patch plan", () => {
    const plan = withTaskGraph(patchPlan("fix the failing test and verify it"));

    expect(plan.taskGraph).toBeTruthy();
    expect(validateTaskGraph(plan.taskGraph!).ok).toBe(true);
    expect(plan.taskGraph?.schemaVersion).toBe("task-graph/v1");
    expect(plan.taskGraph?.nodes.some((node) => node.ownerRole === "coder_a" && node.kind === "patch")).toBe(true);
    expect(plan.taskGraph?.nodes.find((node) => node.id === "apply_patch")?.dependsOn).toContain("judge_patch");
    expect(plan.taskGraph?.nodes.find((node) => node.id === "verify_patch")?.dependsOn).toContain("apply_patch");
  });

  it("adds governance nodes for high-risk contracts", () => {
    const workflowIntent = workflowIntentFixture("fix auth token handling bug", "patch");
    const scenarioProfile = scenarioProfileFixture("debugging", "patch", ["correctness_critical", "security_sensitive"]);
    const contract = {
      ...generateNativeObjectiveContract({
        goal: "fix auth token handling bug",
        workflowIntent,
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
    const plan = withTaskGraph(readOnlyPlan("inspect README and summarize without editing files"));

    expect(plan.taskType).toBe("analysis");
    expect(plan.taskGraph?.nodes.flatMap((node) => node.roleHints)).not.toContain("coder_a");
    expect(plan.taskGraph?.nodes.flatMap((node) => node.roleHints)).not.toContain("runner");
    expect(plan.taskGraph?.nodes.some((node) => node.mutationAllowed)).toBe(false);
  });

  it("rejects read-only graphs with mutation nodes", () => {
    const plan = withTaskGraph(readOnlyPlan("inspect README and summarize without editing files"));
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
    const plan = withTaskGraph(patchPlan("fix the failing test and verify it"));
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

function withTaskGraph(plan: Plan): Plan {
  return { ...plan, taskGraph: buildTaskGraph({ plan }) };
}

function patchPlan(goal: string): Plan {
  return {
    goal,
    constraints: [],
    riskLevel: "medium",
    taskType: "bugfix",
    workflowKind: "patch",
    requiresPatchWorkflow: true,
    steps: [
      { id: "inspect_context", title: "Inspect context", detail: "Inspect relevant files.", status: "done" },
      { id: "design_patch", title: "Design patch", detail: "Prepare patch strategy.", status: "pending" },
      { id: "produce_patch", title: "Produce patch", detail: "Generate candidate diff.", status: "pending" },
      { id: "review_patch", title: "Review patch", detail: "Review candidate.", status: "pending" },
      { id: "judge_patch", title: "Judge patch", detail: "Select candidate.", status: "pending" },
      { id: "apply_patch", title: "Apply patch", detail: "Apply selected diff.", status: "pending" },
      { id: "verify_patch", title: "Verify patch", detail: "Run verification.", status: "pending" }
    ],
    verificationCommands: ["npm test"],
    debateRecommended: true
  };
}

function readOnlyPlan(goal: string): Plan {
  return {
    goal,
    constraints: [],
    riskLevel: "low",
    taskType: "analysis",
    workflowKind: "read_only",
    requiresPatchWorkflow: false,
    steps: [
      { id: "inspect_context", title: "Inspect context", detail: "Read requested context.", status: "done" },
      { id: "summarize_findings", title: "Summarize findings", detail: "Return a read-only answer.", status: "pending" }
    ],
    verificationCommands: [],
    debateRecommended: false
  };
}

function workflowIntentFixture(goal: string, workflowKind: WorkflowIntentDecision["workflowKind"]): WorkflowIntentDecision {
  const requiresPatchWorkflow = workflowKind === "patch" || workflowKind === "repair" || workflowKind === "vision_patch";
  return {
    intent: requiresPatchWorkflow ? "patch" : "inspect",
    requiresPatchWorkflow,
    workflowKind,
    confidence: 1,
    reason: `Test fixture declares ${workflowKind} workflow for ${goal}.`,
    provider: "test_fixture",
    model: "semantic-fixture",
    fallbackUsed: false
  };
}

function scenarioProfileFixture(
  scenarioType: ScenarioProfile["scenarioType"],
  workflowKind: ScenarioProfile["likelyWorkflowKind"],
  riskSignals: string[] = []
): ScenarioProfile {
  return {
    scenarioType,
    userIntent: `${scenarioType} fixture intent`,
    expectedDeliverable: workflowKind === "read_only" ? "read-only answer with evidence" : "patch workflow evidence",
    ambiguityLevel: "low",
    likelyWorkflowKind: workflowKind,
    riskSignals,
    evidenceNeeds: workflowKind === "read_only" ? ["event ledger", "inspected context"] : ["event ledger", "patch diff", "review decision", "judge decision"],
    suggestedRoles: workflowKind === "read_only" ? ["planner", "explorer", "summarizer"] : ["planner", "explorer", "coder_a", "reviewer", "judge", "runner", "summarizer"]
  };
}
