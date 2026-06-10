import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";

describe("governed workflow execution", () => {
  it("does not invoke external planner reviewer or judge after budget block", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      strong_agents: {
        ...defaultConfig.strong_agents,
        max_calls_per_task: 0
      },
      debate: { ...defaultConfig.debate, max_candidates: 1 },
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-role-external-mcp-server.mjs")],
          autoStart: true,
          roles: ["planner", "reviewer", "judge"],
          capabilities: ["planning", "review", "judgment"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "external:codex", model: "auto" },
        reviewer: { provider: "external:codex", model: "auto" },
        judge: { provider: "external:codex", model: "auto" }
      }
    };

    const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true });
    const blockedRoles = state.events
      .filter((event) => event.type === "budget_decision" && event.status === "blocked")
      .map((event) => event.role);
    const externalCalls = state.events
      .filter((event) => event.type === "external_agent_call")
      .map((event) => event.role);
    const blockedAgentRuns = state.events
      .filter((event) => event.type === "agent_run" && event.status === "blocked")
      .map((event) => event.role);
    const externalSuccesses = state.events.filter((event) =>
      event.type === "agent_run"
      && event.status === "success"
      && event.provider === "external:codex"
      && ["planner", "reviewer", "judge"].includes(event.role ?? "")
    );

    expect(blockedRoles).toEqual(expect.arrayContaining(["planner", "reviewer", "judge"]));
    expect(blockedAgentRuns).toEqual(expect.arrayContaining(["planner", "reviewer", "judge"]));
    expect(externalCalls).not.toEqual(expect.arrayContaining(["planner", "reviewer", "judge"]));
    expect(externalSuccesses).toEqual([]);
    expect(state.agents.filter((agent) => agent.provider === "local_tool" && agent.model.startsWith("native_")).map((agent) => agent.role)).toEqual(expect.arrayContaining(["planner", "reviewer", "judge"]));
  }, 15_000);

  it("enforces reviewer role budget without consuming planner or judge role budgets", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-governed-budget-"));
    const config = {
      ...defaultConfig,
      debate: { ...defaultConfig.debate, max_candidates: 1 },
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-role-external-mcp-server.mjs")],
          autoStart: true,
          roles: ["reviewer"],
          capabilities: ["review"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        reviewer: {
          provider: "external:codex",
          model: "auto",
          budget: { max_calls_per_task: 0 }
        }
      }
    };

    try {
      await cp(source, cwd, { recursive: true });
      const state = await runOfflineGraph(cwd, "fix failing test", config, { fixtureMode: true });
      const reviewerBudget = state.events.find((event) => event.type === "budget_decision" && event.role === "reviewer");
      const plannerRoleBudget = state.events.find((event) => event.type === "budget_decision" && event.role === "planner" && event.budgetScope !== "efficient" && !event.invocationKind);
      const plannerModelBudget = state.events.find((event) => event.type === "budget_decision" && event.role === "planner" && event.invocationKind === "model_planner");
      const plannerGovernanceBudget = state.events.find((event) => event.type === "budget_decision" && event.role === "planner" && event.invocationKind === "task_governance");
      const judgeBudget = state.events.find((event) => event.type === "budget_decision" && event.role === "judge");

      expect(reviewerBudget).toMatchObject({ status: "blocked", budgetScope: "per_role" });
      expect(plannerModelBudget).toMatchObject({ status: "allowed" });
      expect(plannerGovernanceBudget).toMatchObject({ status: "allowed" });
      expect(plannerRoleBudget).toBeUndefined();
      expect(judgeBudget).toBeUndefined();
      expect(state.review).toBeTruthy();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 15_000);
});
