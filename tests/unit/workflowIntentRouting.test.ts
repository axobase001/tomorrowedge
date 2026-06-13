import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createEventLedger } from "../../src/core/events/eventLedger.js";
import { classifyWorkflowIntent } from "../../src/core/goal/workflowIntent.js";
import { ModelRouter } from "../../src/core/routing/router.js";

describe("workflow intent routing", () => {
  it.each([
    ["list files and summarize structure", "read_only", false],
    ["\u8bfb\u53d6 quantum \u6587\u4ef6\u5939\u5185\u5bb9\uff0c\u8f93\u51fa\u6587\u4ef6\u7ed3\u6784", "read_only", false],
    ["fix failing test", "patch", true],
    ["implement OAuth login", "patch", true],
    ["review architecture and suggest improvements, do not edit", "read_only", false],
    ["generate UI from screenshot", "vision_patch", true]
  ] as const)("routes %s through a model semantic classifier", async (goal, workflowKind, requiresPatchWorkflow) => {
    const ledger = createEventLedger("partial");
    const decision = await classifyWorkflowIntent({
      goal,
      config: defaultConfig,
      router: new ModelRouter(defaultConfig),
      ledger,
      fixtureMode: true
    });

    expect(decision.workflowKind).toBe(workflowKind);
    expect(decision.requiresPatchWorkflow).toBe(requiresPatchWorkflow);
    expect(decision.provider).toBe("mock");
    expect(ledger.events).toContainEqual(expect.objectContaining({
      type: "model_call",
      provider: "mock",
      model: "mock-balanced"
    }));
  });

  it("treats Chinese file creation with read-only constraints as a patch workflow via the model route", async () => {
    const ledger = createEventLedger("partial");
    const goal = "\u521b\u5efa assignments/finite-division-ring-field/proof.md \u548c proof.html\uff0c\u4e0d\u662f\u53ea\u8bfb\u5206\u6790\uff0c\u4e0d\u8981\u4fee\u6539\u5176\u4ed6\u6587\u4ef6\uff0c\u5fc5\u987b\u751f\u6210 patch";
    const decision = await classifyWorkflowIntent({
      goal,
      config: defaultConfig,
      router: new ModelRouter(defaultConfig),
      ledger,
      fixtureMode: true
    });

    expect(decision.workflowKind).toBe("patch");
    expect(decision.requiresPatchWorkflow).toBe(true);
    expect(decision.reason).toContain("Mock intent model");
    expect(ledger.events.some((event) => event.type === "model_call" && event.provider === "mock")).toBe(true);
  });
});
