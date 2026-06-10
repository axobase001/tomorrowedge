import { describe, expect, it } from "vitest";
import { buildRoleGraph } from "../../src/core/orchestration/roleGraph.js";
import { createRoleGraphExecutionState, markRoleNodeResult, markRoleNodeRunning, readyRoleNodes, shouldStopRoleGraph } from "../../src/core/orchestration/roleGraphScheduler.js";

describe("role graph scheduler", () => {
  it("tracks ready nodes and unlocks dependent roles", () => {
    const graph = buildRoleGraph({ workflowKind: "patch", debate: true });
    const state = createRoleGraphExecutionState(graph);

    expect(readyRoleNodes(state).map((node) => node.role)).toEqual(["planner"]);
    markRoleNodeRunning(state, "planner");
    markRoleNodeResult(state, { role: "planner", status: "success", summary: "planned" });

    expect(readyRoleNodes(state).map((node) => node.role)).toContain("explorer");
    expect(state.results[0]).toMatchObject({ role: "planner", nodeId: "planner", status: "success" });
  });

  it("stops when a required node is blocked", () => {
    const graph = buildRoleGraph({ workflowKind: "patch" });
    const state = createRoleGraphExecutionState(graph);

    markRoleNodeResult(state, { role: "planner", status: "blocked", summary: "budget blocked", error: "budget blocked" });

    expect(shouldStopRoleGraph(state)).toBe(true);
    expect(state.stopReason).toContain("required role node planner");
  });
});
