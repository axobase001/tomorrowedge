import { describe, expect, it } from "vitest";
import { buildTaskGraph } from "../../src/core/planning/taskGraphBuilder.js";
import { nextReadyTaskNodes, readyTaskNodeForRoleNode, taskGraphAllowsRoleNode } from "../../src/core/planning/taskGraphScheduler.js";
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

  it("adds and schedules an alternative patch task only when the RoleGraph permits coder_b", () => {
    const roleGraph = buildRoleGraph({ workflowKind: "patch", debate: true, allowParallelRoles: true });
    const graph = buildTaskGraph({ plan: { ...patchPlan(), debateRecommended: true }, roleGraph });
    const coderB = roleGraph.nodes.find((node) => node.id === "coder_b")!;
    const reviewer = roleGraph.nodes.find((node) => node.id === "reviewer")!;

    expect(graph.nodes.some((node) => node.id === "produce_patch_alt" && node.ownerRole === "coder_b")).toBe(true);
    for (const id of ["inspect_context", "design_patch", "produce_patch"]) markDone(graph, id);
    expect(taskGraphAllowsRoleNode(graph, reviewer)).toBe(false);
    expect(readyTaskNodeForRoleNode(graph, coderB)?.id).toBe("produce_patch_alt");

    markSkipped(graph, "produce_patch_alt");
    expect(taskGraphAllowsRoleNode(graph, reviewer)).toBe(true);
    expect(readyTaskNodeForRoleNode(graph, reviewer)?.id).toBe("review_patch");
  });

  it("drives read-only inspect before summarize", () => {
    const graph = buildTaskGraph({ plan: { ...patchPlan(), taskType: "analysis", workflowKind: "read_only", requiresPatchWorkflow: false } });

    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toEqual(["inspect_context"]);
    markDone(graph, "inspect_context");
    expect(nextReadyTaskNodes(graph).map((node) => node.id)).toEqual(["summarize_findings"]);
  });

  it("drives high-risk security review before judge", () => {
    const roleGraph = buildRoleGraph({ workflowKind: "patch", riskLevel: "high", debate: true });
    const graph = buildTaskGraph({ plan: { ...patchPlan(), riskLevel: "high", debateRecommended: true }, roleGraph });
    const reviewer = roleGraph.nodes.find((node) => node.id === "reviewer")!;
    const judge = roleGraph.nodes.find((node) => node.id === "judge")!;

    expect(graph.nodes.find((node) => node.id === "security_review")?.dependsOn).toEqual(["produce_patch", "produce_patch_alt"]);
    for (const id of ["inspect_context", "risk_map", "design_patch", "produce_patch", "produce_patch_alt"]) markDone(graph, id);
    expect(readyTaskNodeForRoleNode(graph, reviewer)?.id).toBe("security_review");
    expect(taskGraphAllowsRoleNode(graph, judge)).toBe(false);

    markDone(graph, "security_review");
    expect(readyTaskNodeForRoleNode(graph, judge)?.id).toBe("judge_patch");
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
