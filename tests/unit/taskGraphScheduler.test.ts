import { describe, expect, it } from "vitest";
import { buildTaskGraph } from "../../src/core/planning/taskGraphBuilder.js";
import { nextReadyTaskNodes, taskGraphAllowsRoleNode } from "../../src/core/planning/taskGraphScheduler.js";
import { buildRoleGraph } from "../../src/core/orchestration/roleGraph.js";
import type { Plan } from "../../src/schemas/plan.js";

describe("task graph scheduler", () => {
  it("exposes ready task nodes in dependency order", () => {
    const graph = buildTaskGraph({ plan: patchPlan() });

    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toEqual(["inspect_context"]);
    markDone(graph, "inspect_context");
    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toEqual(["design_patch"]);
    markDone(graph, "design_patch");
    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toEqual(["produce_patch"]);
  });

  it("does not allow apply or verify actions before their task dependencies are ready", () => {
    const graph = buildTaskGraph({ plan: patchPlan() });
    const roleGraph = buildRoleGraph({ workflowKind: "patch" });
    const patchRunner = roleGraph.nodes.find((node) => node.id === "patch_runner")!;
    const testRunner = roleGraph.nodes.find((node) => node.id === "test_runner")!;

    expect(taskGraphAllowsRoleNode(graph, patchRunner)).toBe(false);
    expect(taskGraphAllowsRoleNode(graph, testRunner)).toBe(false);

    for (const id of ["inspect_context", "design_patch", "produce_patch", "review_patch", "judge_patch"]) markDone(graph, id);
    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toContain("apply_patch");
    expect(taskGraphAllowsRoleNode(graph, patchRunner)).toBe(true);
    expect(taskGraphAllowsRoleNode(graph, testRunner)).toBe(false);

    markSkipped(graph, "apply_patch");
    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toContain("verify_patch");
    expect(taskGraphAllowsRoleNode(graph, testRunner)).toBe(true);
  });

  it("drives read-only inspect before summarize", () => {
    const graph = buildTaskGraph({ plan: { ...patchPlan(), taskType: "analysis", workflowKind: "read_only", requiresPatchWorkflow: false } });

    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toEqual(["inspect_context"]);
    markDone(graph, "inspect_context");
    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toEqual(["summarize_findings"]);
  });
});

function patchPlan(): Plan {
  return {
    goal: "fix failing test",
    constraints: [],
    riskLevel: "low",
    taskType: "bugfix",
    workflowKind: "patch",
    requiresPatchWorkflow: true,
    steps: [{ id: "fix", title: "Fix", detail: "Fix the failing test", status: "pending" }],
    verificationCommands: ["npm test"],
    debateRecommended: false
  };
}

function markDone(graph: ReturnType<typeof buildTaskGraph>, id: string): void {
  const node = graph.nodes.find((item) => item.id === id);
  if (node) node.status = "done";
}

function markSkipped(graph: ReturnType<typeof buildTaskGraph>, id: string): void {
  const node = graph.nodes.find((item) => item.id === id);
  if (node) node.status = "skipped";
}
