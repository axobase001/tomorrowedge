import { describe, expect, it } from "vitest";
import { classifyWorkflowIntentLocally } from "../../src/core/goal/workflowIntent.js";

describe("workflow intent routing", () => {
  it.each([
    ["list files and summarize structure", "read_only", false],
    ["读取 quantum 文件夹内容，输出文件结构", "read_only", false],
    ["fix failing test", "patch", true],
    ["implement OAuth login", "patch", true],
    ["review architecture and suggest improvements, do not edit", "read_only", false],
    ["generate UI from screenshot", "vision_patch", true]
  ] as const)("classifies %s", (goal, workflowKind, requiresPatchWorkflow) => {
    const decision = classifyWorkflowIntentLocally(goal);
    expect(decision.workflowKind).toBe(workflowKind);
    expect(decision.requiresPatchWorkflow).toBe(requiresPatchWorkflow);
  });
});
