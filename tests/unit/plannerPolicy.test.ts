import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { allocateStrongAgentCall } from "../../src/core/budget/budgetAllocator.js";
import { defaultStrongAgentBudget } from "../../src/core/budget/strongAgentBudget.js";
import { isDocumentOnlyGoal, parseGoalToPlan } from "../../src/core/goal/goalParser.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";

describe("adaptive planning and governance policies", () => {
  it("keeps the legacy native parser semantically neutral", () => {
    const readOnly = parseGoalToPlan("read the quantum folder and summarize the file structure");
    const feature = parseGoalToPlan("implement OAuth login across the backend and frontend");

    expect(readOnly.taskType).toBe("unknown");
    expect(readOnly.workflowKind).toBe("ask_user");
    expect(readOnly.verificationCommands).toEqual([]);
    expect(readOnly.steps.map((step) => step.id)).toEqual(["semantic-route-required"]);
    expect(feature.taskType).toBe("unknown");
    expect(feature.riskLevel).toBe("medium");
    expect(feature.steps.map((step) => step.id)).toEqual(["semantic-route-required"]);
  });

  it("does not run repository test commands for document-only deliverables", () => {
    const plan = parseGoalToPlan("create assignments/ramsey-six-people/proof.md and assignments/ramsey-six-people/proof.html");

    expect(plan.taskType).toBe("unknown");
    expect(isDocumentOnlyGoal(plan.goal)).toBe(true);
    expect(plan.verificationCommands).toEqual([]);
  });

  it("supports per-role budget limits while the global strong pool has room", () => {
    const allowed = allocateStrongAgentCall("reviewer", 1, { ...defaultStrongAgentBudget, maxCallsPerTask: 100 }, {
      estimatedCostUsd: 0.4,
      roleBudget: { maxCostPerCallUsd: 0.5, maxCallsPerTask: 2 },
      roleUsedCalls: 1
    });
    const blocked = allocateStrongAgentCall("reviewer", 0, defaultStrongAgentBudget, {
      estimatedCostUsd: 0.6,
      roleBudget: { maxCostPerCallUsd: 0.5, maxCallsPerTask: 2 },
      roleUsedCalls: 0
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.scope).toBe("per_role");
    expect(allowed.remainingCalls).toBe(1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("agents.reviewer.budget.max_cost_per_call_usd");
  });

  it("reroutes reviewer and judge after a high-risk planner result", async () => {
    const cwd = "tests/fixtures/sample-repo-basic";
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, mode: "cheap" },
      debate: { ...defaultConfig.debate, max_candidates: 1 },
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, model: "openai/gpt-5.2" },
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true, model: "deepseek-v4-pro" }
      },
      agents: {
        ...defaultConfig.agents,
        reviewer: {
          ...defaultConfig.agents.reviewer,
          budget: { max_cost_per_call_usd: 1.5, max_calls_per_task: 2 }
        }
      }
    };

    const state = await runOfflineGraph(cwd, "fix OAuth token handling without leaking secrets", config, { fixtureMode: true });
    const reviewerRoute = state.routing.assignments.find((assignment) => assignment.role === "reviewer");
    const judgeRoute = state.routing.assignments.find((assignment) => assignment.role === "judge");
    const rerouteEvent = state.events.find((event) => event.type === "routing_decision" && event.phase === "planning" && event.role === "reviewer");
    const roleBudgetEvent = state.events.find((event) => event.type === "budget_preview" && event.role === "reviewer" && "budgetScope" in event && event.budgetScope === "per_role");

    expect(state.plan?.riskLevel).toBe("high");
    expect(state.events.some((event) => event.type === "model_call" && event.provider === "mock")).toBe(true);
    expect(reviewerRoute?.provider).toBe("openrouter");
    expect(judgeRoute?.provider).toBe("openrouter");
    expect(rerouteEvent).toBeTruthy();
    expect(roleBudgetEvent).toBeTruthy();
  });
});
