import { describe, expect, it } from "vitest";
import { buildRoleGraph, optionalNodeCanSkip } from "../../src/core/orchestration/roleGraph.js";

describe("role graph", () => {
  it("keeps read-only workflows out of coding, review, and judge roles", () => {
    const graph = buildRoleGraph({ workflowKind: "read_only" });
    const roles = graph.nodes.map((node) => node.role);

    expect(roles).toEqual(["planner", "explorer", "summarizer"]);
    expect(roles).not.toContain("coder_a");
    expect(roles).not.toContain("reviewer");
    expect(roles).not.toContain("judge");
  });

  it("includes patch roles for normal patch workflows", () => {
    const graph = buildRoleGraph({ workflowKind: "patch" });
    expect(graph.nodes.map((node) => node.role)).toEqual(expect.arrayContaining(["coder_a", "reviewer", "judge", "runner"]));
  });

  it("requires reviewer and judge for high-risk patch workflows", () => {
    const graph = buildRoleGraph({ workflowKind: "patch", highRisk: true });
    expect(graph.workflowKind).toBe("high_risk_patch");
    expect(graph.nodes.find((node) => node.role === "reviewer")?.required).toBe(true);
    expect(graph.nodes.find((node) => node.role === "judge")?.required).toBe(true);
  });

  it("marks coder_b as an optional parallel candidate node", () => {
    const graph = buildRoleGraph({ workflowKind: "patch", debate: true });
    const coderB = graph.nodes.find((node) => node.role === "coder_b");
    expect(coderB?.dependencies).toEqual(["explorer"]);
    expect(coderB?.canSkip).toBe(true);
    expect(optionalNodeCanSkip(graph, "coder_b")).toBe(true);
  });

  it("disables optional parallel candidate nodes when policy forbids parallel roles", () => {
    const graph = buildRoleGraph({ workflowKind: "patch", debate: true, highRisk: true, allowParallelRoles: false });
    const roles = graph.nodes.map((node) => node.role);

    expect(graph.workflowKind).toBe("high_risk_patch");
    expect(roles).not.toContain("coder_b");
    expect(roles).toEqual(expect.arrayContaining(["coder_a", "reviewer", "judge"]));
    expect(graph.nodes.find((node) => node.role === "reviewer")?.dependencies).toEqual(["coder_a"]);
  });

  it("filters forbidden contract roles out of the role graph", () => {
    const graph = buildRoleGraph({
      workflowKind: "patch",
      allowedRoles: ["planner", "explorer", "coder_a", "reviewer", "judge", "summarizer"],
      allowedPhases: ["planning", "exploration", "coding", "review", "judge", "summary"]
    });
    const roles = graph.nodes.map((node) => node.role);

    expect(roles).toEqual(expect.arrayContaining(["planner", "explorer", "coder_a", "reviewer", "judge", "summarizer"]));
    expect(roles).not.toContain("runner");
    expect(roles).not.toContain("repairer");
  });

  it("forces reviewer and judge for high-risk contracts even when the input omitted them", () => {
    const graph = buildRoleGraph({
      workflowKind: "patch",
      riskLevel: "high",
      allowedRoles: ["planner", "explorer", "coder_a", "summarizer"],
      allowedPhases: ["planning", "exploration", "coding", "summary"]
    });

    expect(graph.nodes.find((node) => node.role === "reviewer")?.required).toBe(true);
    expect(graph.nodes.find((node) => node.role === "judge")?.required).toBe(true);
  });

  it("keeps read-only contracts out of coder, runner, and repairer even if roles were supplied", () => {
    const graph = buildRoleGraph({
      workflowKind: "read_only",
      allowedRoles: ["planner", "explorer", "coder_a", "runner", "repairer", "summarizer"],
      allowedPhases: ["planning", "exploration", "coding", "patch", "shell", "repair", "summary"]
    });
    const roles = graph.nodes.map((node) => node.role);

    expect(roles).toEqual(["planner", "explorer", "summarizer"]);
  });
});
