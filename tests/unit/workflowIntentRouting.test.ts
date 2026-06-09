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

  it("treats Chinese file creation with read-only constraints as a patch workflow", () => {
    const goal = "\u521b\u5efa assignments/finite-division-ring-field/proof.md \u548c proof.html\uff0c\u4e0d\u662f\u53ea\u8bfb\u5206\u6790\uff0c\u4e0d\u8981\u4fee\u6539\u5176\u4ed6\u6587\u4ef6\uff0c\u5fc5\u987b\u751f\u6210 patch";
    const decision = classifyWorkflowIntentLocally(goal);

    expect(decision.workflowKind).toBe("patch");
    expect(decision.requiresPatchWorkflow).toBe(true);
    expect(decision.reason).toContain("explicit create/write/patch");
  });
});
