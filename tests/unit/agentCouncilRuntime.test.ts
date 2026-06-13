import { describe, expect, it } from "vitest";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { buildCockpitViewModel } from "../../src/cockpit/viewModel.js";
import { buildAgentRuntimeProfiles } from "../../src/core/agents/defaultCapabilityProfiles.js";
import { selectChiefAgent } from "../../src/core/chiefAgent/chiefAgentRouter.js";
import { runAgentCouncilGovernance } from "../../src/core/council/councilRuntime.js";

describe("Sirius Agent Council Governance Runtime", () => {
  it("routes high-level engineering tasks to the configured chief agent first", () => {
    const config = siriusConfig();
    const agents = buildAgentRuntimeProfiles(config);
    const chief = selectChiefAgent({
      config,
      goal: "rewrite this application in Rust",
      availableAgents: agents
    });

    expect(chief?.id).toBe("codex");
    expect(chief?.provider).toBe("external:codex");
    expect(chief?.roles).toContain("lead_planner");
  });

  it("blocks a configured but unavailable chief agent instead of silently downgrading", async () => {
    const config = siriusConfig();
    config.chief_agent.id = "missing-chief";
    config.chief_agent.provider = "external:missing-chief";

    await expect(runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      config,
      { accessMode: "full" }
    )).rejects.toThrow("No Chief Agent available");
  });

  it("runs chief planning, council critique, ownership assignment, delegated execution, mutation, and final chief review", async () => {
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      siriusConfig(),
      { accessMode: "full", simulateFailureTaskId: "rust_cli_structure" }
    );

    expect(state.chiefAgent?.id).toBe("codex");
    expect(state.chiefDecision?.action).toBe("convene_council");
    expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "chief_agent_selected",
      "chief_initial_plan",
      "council_session_started",
      "council_move",
      "council_consensus",
      "task_ownership_assignment",
      "delegated_task_result",
      "strategy_mutation",
      "strategy_selection_decision",
      "chief_final_review",
      "chief_delivery_approved"
    ]));
    expect(state.council?.moves.some((move) => move.type === "critique")).toBe(true);
    expect(state.council?.moves.some((move) => move.type === "gap_fill")).toBe(true);
    expect(state.council?.moves.some((move) => move.type === "final_consensus")).toBe(true);

    const taskNodes = state.plan?.taskGraph?.nodes ?? [];
    expect(taskNodes.length).toBeGreaterThanOrEqual(5);
    expect(taskNodes.every((node) => node.ownerAgentId && node.assignedProvider && node.assignmentReason)).toBe(true);
    expect(new Set(taskNodes.map((node) => node.ownerAgentId)).size).toBeGreaterThanOrEqual(2);
    expect(taskNodes.every((node) => node.status === "done")).toBe(true);
    expect(taskNodes.every((node) => (node.evidenceRefs ?? []).length > 0)).toBe(true);
    expect(taskNodes.every((node) => (node.artifactRefs ?? []).length > 0)).toBe(true);

    const latestRustResult = [...(state.delegatedTaskResults ?? [])].reverse().find((result) => result.taskNodeId === "rust_cli_structure");
    expect(latestRustResult?.status).toBe("success");
    expect(state.strategyMutations?.[0]?.trigger).toBe("test_failed");
    expect(state.strategyMutations?.[0]?.selected).toBe(true);
    expect(state.finalChiefReview?.decision).toBe("approve_delivery");
    expect(state.finalSummary?.result).toBe("completed");
  });

  it("projects Sirius governance into the cockpit view model", async () => {
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      siriusConfig(),
      { accessMode: "full", simulateFailureTaskId: "rust_cli_structure" }
    );
    const vm = buildCockpitViewModel(process.cwd(), state);

    expect(vm.chiefAgent?.chiefAgentId).toBe("codex");
    expect(vm.council?.members.length).toBeGreaterThanOrEqual(3);
    expect(vm.taskOwnership?.assignments.length).toBeGreaterThanOrEqual(5);
    expect(vm.taskOwnership?.assignments.some((assignment) => assignment.ownerAgentId === "deepseek")).toBe(true);
    expect(vm.taskOwnership?.assignments.some((assignment) => assignment.ownerAgentId === "mimo")).toBe(true);
    expect(vm.policyMutations?.count).toBe(1);
    expect(vm.finalReview?.decision).toBe("approve_delivery");
    expect(vm.taskGraph?.nodes.every((node) => node.ownerAgentId && node.assignmentReason)).toBe(true);
  });

  it("can invoke a configured external command agent for owned council nodes", async () => {
    const commandConfig = siriusConfig();
    commandConfig.external_agents.codex = {
      ...commandConfig.external_agents.codex,
      command: process.execPath,
      args: [path.join(process.cwd(), "tests", "fixtures", "mock-command-agent.mjs")]
    };
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      commandConfig,
      { accessMode: "full" }
    );
    const externalEvents = state.events.filter((event) => event.type === "external_agent_call" || event.type === "external_agent_result");

    expect(externalEvents.length).toBeGreaterThan(0);
    expect(state.events.some((event) => event.type === "external_agent_result" && event.summary.includes("mock command handled"))).toBe(true);
    expect(state.delegatedTaskResults?.some((result) => result.artifactRefs.some((ref) => ref.includes("external_agent_response")))).toBe(true);
    expect(state.finalChiefReview?.decision).toBe("approve_delivery");
  });
});

function siriusConfig(): TomorrowEdgeConfig {
  return {
    ...defaultConfig,
    providers: {
      ...defaultConfig.providers,
      deepseek: { ...defaultConfig.providers.deepseek, enabled: true },
      mimo: { ...defaultConfig.providers.mimo, enabled: true },
      mock: { ...defaultConfig.providers.mock, enabled: true },
      fixture: { ...defaultConfig.providers.fixture, enabled: true }
    },
    external_agents: {
      ...defaultConfig.external_agents,
      codex: {
        ...defaultConfig.external_agents.codex,
        enabled: true,
        roles: ["core", "planner", "reviewer", "judge", "coder_a", "repairer"],
        capabilities: ["core", "planning", "architecture", "review", "judgment", "coding", "tool_use"],
        trustLevel: "high"
      }
    },
    chief_agent: {
      ...defaultConfig.chief_agent,
      id: "codex",
      provider: "external:codex",
      model: "Codex"
    },
    agent_capabilities: {
      ...defaultConfig.agent_capabilities,
      deepseek: {
        coding: 0.9,
        patchGeneration: 0.9,
        repair: 0.8,
        costTier: "medium",
        trustLevel: "medium"
      },
      mimo: {
        testGeneration: 0.76,
        coding: 0.68,
        costTier: "cheap",
        trustLevel: "medium"
      }
    },
    strong_agents: {
      ...defaultConfig.strong_agents,
      max_calls_per_task: 8
    }
  };
}
