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
});
