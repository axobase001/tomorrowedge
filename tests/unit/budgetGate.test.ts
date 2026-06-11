import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { createBudgetRuntimeState, evaluateModelCallInvocation, evaluateRoleInvocation, commitRoleCall, releaseRoleCall, reserveRoleCall } from "../../src/core/budget/budgetGate.js";

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

  it("commits role-specific strong calls against both role and global pools", () => {
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
    expect(runtime.strongAgentCallsUsed).toBe(1);
    expect(runtime.realStrongAgentCallsUsed).toBe(1);
    expect(runtime.simulatedStrongAgentCallsUsed).toBe(0);
    expect(second.action).toBe("block");
  });

  it("splits committed strong-agent calls into real and simulated counters", () => {
    const runtime = createBudgetRuntimeState();
    const real = evaluateModelCallInvocation({
      config: defaultConfig,
      runtime,
      invocation: "live_advisory",
      role: "reviewer",
      assignment: { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", reason: "real review" }
    });
    const simulated = evaluateModelCallInvocation({
      config: defaultConfig,
      runtime,
      invocation: "task_governance",
      role: "planner",
      assignment: { role: "planner", provider: "mock", model: "mock-balanced", reason: "fixture governance" }
    });

    commitRoleCall(runtime, reserveRoleCall(runtime, real));
    commitRoleCall(runtime, reserveRoleCall(runtime, simulated));

    expect(runtime.strongAgentCallsUsed).toBe(2);
    expect(runtime.realStrongAgentCallsUsed).toBe(1);
    expect(runtime.simulatedStrongAgentCallsUsed).toBe(1);
  });

  it("blocks role-budgeted strong calls when the global pool is exhausted", () => {
    const runtime = createBudgetRuntimeState();
    const config = {
      ...defaultConfig,
      strong_agents: { ...defaultConfig.strong_agents, max_calls_per_task: 1 },
      agents: {
        ...defaultConfig.agents,
        reviewer: {
          ...defaultConfig.agents.reviewer,
          budget: { max_calls_per_task: 5 }
        }
      }
    };
    const first = evaluateRoleInvocation({
      config,
      runtime,
      role: "reviewer",
      phase: "review",
      assignment: { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", reason: "strong review" },
      roleBudget: { maxCallsPerTask: 5 }
    });
    commitRoleCall(runtime, reserveRoleCall(runtime, first));
    const second = evaluateRoleInvocation({
      config,
      runtime,
      role: "reviewer",
      phase: "review",
      assignment: { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", reason: "strong review" },
      roleBudget: { maxCallsPerTask: 5 }
    });

    expect(first.action).toBe("allow");
    expect(second.action).toBe("block");
    expect(second.reason).toContain("Strong-agent call budget exhausted");
    expect(runtime.roleCallsUsed.reviewer).toBe(1);
    expect(runtime.strongAgentCallsUsed).toBe(1);
  });

  it("reserves live model invocations without consuming budget until commit", () => {
    const runtime = createBudgetRuntimeState();
    const decision = evaluateModelCallInvocation({
      config: defaultConfig,
      runtime,
      invocation: "live_patch",
      role: "coder_a",
      assignment: { role: "coder_a", provider: "openrouter", model: "openai/gpt-5.2", reason: "live patch" },
      estimatedCostUsd: 0.01
    });
    const reservation = reserveRoleCall(runtime, decision);

    expect(decision.action).toBe("allow");
    expect(runtime.strongAgentCallsUsed).toBe(0);
    commitRoleCall(runtime, reservation);
    expect(runtime.strongAgentCallsUsed).toBe(1);
  });

  it("releases failed live model invocation reservations without consuming calls", () => {
    const runtime = createBudgetRuntimeState();
    const decision = evaluateModelCallInvocation({
      config: defaultConfig,
      runtime,
      invocation: "live_advisory",
      role: "reviewer",
      assignment: { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", reason: "live advisory" },
      estimatedCostUsd: 0.01
    });
    const reservation = reserveRoleCall(runtime, decision);

    releaseRoleCall(runtime, reservation, "provider failed");

    expect(decision.action).toBe("allow");
    expect(runtime.strongAgentCallsUsed).toBe(0);
    expect(reservation.released).toBe(true);
  });
});
