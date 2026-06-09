import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createBudgetRuntimeState, evaluateRoleInvocation, commitRoleCall, reserveRoleCall } from "../../src/core/budget/budgetGate.js";

describe("budget gate", () => {
  it("blocks strong-agent invocation when global call budget is exhausted", () => {
    const runtime = createBudgetRuntimeState();
    const decision = evaluateRoleInvocation({
      config: { ...defaultConfig, strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 0 } },
      runtime,
      role: "reviewer",
      phase: "review",
      assignment: { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", reason: "strong review" },
      estimatedCostUsd: 0.01
    });

    expect(decision.action).toBe("block");
    expect(decision.reason).toContain("budget exhausted");
    expect(runtime.strongAgentCallsUsed).toBe(0);
  });

  it("commits role-specific calls independently from the global strong pool", () => {
    const runtime = createBudgetRuntimeState();
    const config = {
      ...defaultConfig,
      agents: {
        ...defaultConfig.agents,
        reviewer: {
          ...defaultConfig.agents.reviewer,
          budget: { max_calls_per_task: 1 }
        }
      }
    };
    const first = evaluateRoleInvocation({
      config,
      runtime,
      role: "reviewer",
      phase: "review",
      assignment: { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", reason: "strong review" },
      roleBudget: { maxCallsPerTask: 1 }
    });
    const reservation = reserveRoleCall(runtime, first);
    commitRoleCall(runtime, reservation);
    const second = evaluateRoleInvocation({
      config,
      runtime,
      role: "reviewer",
      phase: "review",
      assignment: { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", reason: "strong review" },
      roleBudget: { maxCallsPerTask: 1 }
    });

    expect(first.action).toBe("allow");
    expect(runtime.roleCallsUsed.reviewer).toBe(1);
    expect(runtime.strongAgentCallsUsed).toBe(0);
    expect(second.action).toBe("block");
  });
});
