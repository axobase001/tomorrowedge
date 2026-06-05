import { describe, expect, it } from "vitest";
import { allocateStrongAgentCall } from "../../src/core/budget/budgetAllocator.js";
import { defaultStrongAgentBudget } from "../../src/core/budget/strongAgentBudget.js";

describe("strong agent budget allocation", () => {
  it("blocks strong-agent calls above the configured max cost", () => {
    const decision = allocateStrongAgentCall("planner", 0, {
      ...defaultStrongAgentBudget,
      maxCostUsd: 0.01
    }, {
      estimatedCostUsd: 0.02
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("strong_agents.max_cost_usd");
  });

  it("uses escalateOn signals to consume reserve for otherwise efficient roles", () => {
    const decision = allocateStrongAgentCall("coder_a", 0, {
      ...defaultStrongAgentBudget,
      escalateOn: ["security_sensitive_change"]
    }, {
      escalationSignals: ["security_sensitive_change"]
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain("security_sensitive_change");
    expect(decision.remainingCalls).toBe(defaultStrongAgentBudget.maxCallsPerTask);
  });
});
