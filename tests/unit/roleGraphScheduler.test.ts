import { describe, expect, it } from "vitest";
import { buildRoleGraph } from "../../src/core/orchestration/roleGraph.js";
import { beginRoleNode, canRunRoleNode, createRoleGraphExecutionState, markRoleNodeResult, markRoleNodeRunning, readyRoleNodes, shouldStopRoleGraph, skipRoleNode } from "../../src/core/orchestration/roleGraphScheduler.js";

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

  it("does not let summarizer complete before runner dependencies are satisfied", () => {
    const graph = buildRoleGraph({ workflowKind: "patch" });
    const state = createRoleGraphExecutionState(graph);

    expect(canRunRoleNode(state, "summarizer")).toBe(false);
    const completed = markRoleNodeResult(state, { role: "summarizer", status: "success", summary: "too early" });

    expect(completed).toBeUndefined();
    expect(state.nodes.summarizer?.status).toBe("pending");
    expect(state.stopReason).toContain("cannot complete before dependencies");
  });

  it("increments attempts for successful normal role executions", () => {
    const graph = buildRoleGraph({ workflowKind: "patch" });
    const state = createRoleGraphExecutionState(graph);

    expect(beginRoleNode(state, "planner")?.attempts).toBe(1);
    markRoleNodeResult(state, { role: "planner", status: "success", summary: "planned" });

    expect(state.nodes.planner?.attempts).toBe(1);
    expect(beginRoleNode(state, "explorer")?.attempts).toBe(1);
    markRoleNodeResult(state, { role: "explorer", status: "success", summary: "explored" });

    expect(state.nodes.explorer?.attempts).toBe(1);
  });

  it("only graph-skippable nodes unlock downstream dependencies when skipped", () => {
    const graph = buildRoleGraph({ workflowKind: "patch", debate: true });
    const state = createRoleGraphExecutionState(graph);
    markRoleNodeResult(state, { role: "planner", status: "success", summary: "planned" });
    markRoleNodeResult(state, { role: "explorer", status: "success", summary: "explored" });
    markRoleNodeResult(state, { role: "coder_a", status: "success", summary: "candidate" });

    skipRoleNode(state, "coder_b", "optional branch skipped", "coder_b");
    expect(readyRoleNodes(state).map((node) => node.role)).toContain("reviewer");

    const strictGraph = {
      workflowKind: "patch" as const,
      stopConditions: [],
      nodes: [
        { id: "a", role: "planner" as const, required: true, dependencies: [], canFallback: false, canSkip: false, maxRetries: 0, produces: [], consumes: [] },
        { id: "b", role: "summarizer" as const, required: true, dependencies: ["a"], canFallback: false, canSkip: false, maxRetries: 0, produces: [], consumes: [] }
      ]
    };
    const strict = createRoleGraphExecutionState(strictGraph);
    skipRoleNode(strict, "planner", "not allowed", "a");
    expect(readyRoleNodes(strict).map((node) => node.id)).not.toContain("b");
  });
});
