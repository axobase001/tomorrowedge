import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { councilRunCommand } from "../../src/cli/commands/council.js";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { buildCockpitViewModel } from "../../src/cockpit/viewModel.js";
import { buildAgentRuntimeProfiles, scoreAgentForRole } from "../../src/core/agents/defaultCapabilityProfiles.js";
import { selectChiefAgent } from "../../src/core/chiefAgent/chiefAgentRouter.js";
import { runAgentCouncilGovernance } from "../../src/core/council/councilRuntime.js";
import { computeTraceCompleteness } from "../../src/core/diagnostics/traceCompleteness.js";
import { loadSession } from "../../src/core/memory/sessionMemory.js";

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

  it("prefers configured real providers over fixture/mock profiles for automatic chief selection", () => {
    const config: TomorrowEdgeConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        deepseek: { ...defaultConfig.providers.deepseek, enabled: true },
        mock: { ...defaultConfig.providers.mock, enabled: true },
        fixture: { ...defaultConfig.providers.fixture, enabled: true }
      },
      chief_agent: { ...defaultConfig.chief_agent, id: "", provider: "" }
    };
    const agents = buildAgentRuntimeProfiles(config);
    const deepseek = agents.find((agent) => agent.agentId === "deepseek");
    const fixture = agents.find((agent) => agent.agentId === "fixture");
    const chief = selectChiefAgent({
      config,
      goal: "1+1=?",
      availableAgents: agents
    });

    expect(deepseek?.allowedRoles).toContain("judge");
    expect(deepseek && fixture ? scoreAgentForRole(deepseek, "chief") > scoreAgentForRole(fixture, "chief") : false).toBe(true);
    expect(chief?.id).toBe("deepseek");
  });

  it("blocks a configured but unavailable chief agent instead of silently downgrading", async () => {
    const config = siriusConfig();
    config.chief_agent.id = "missing-chief";
    config.chief_agent.provider = "external:missing-chief";

    await expect(runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      config,
      { accessMode: "full", fixtureMode: true }
    )).rejects.toThrow("No Chief Agent available");
  });

  it("runs chief planning, council critique, ownership assignment, delegated execution, mutation, and final chief review", async () => {
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      siriusConfig(),
      { accessMode: "full", fixtureMode: true, simulateFailureTaskId: "rust_cli_structure" }
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
      "delegated_execution_mode",
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
    expect(state.strategyMutations?.[0]?.type).toBe("switch_owner_agent");
    expect(state.strategyMutations?.[0]?.changedOwner).toBe(true);
    expect(state.strategyMutations?.[0]?.oldOwnerAgentId).not.toBe(state.strategyMutations?.[0]?.newOwnerAgentId);
    expect(latestRustResult?.ownerAgentId).toBe(state.strategyMutations?.[0]?.newOwnerAgentId);
    expect(state.finalChiefReview?.decision).toBe("approve_delivery");
    expect(state.finalSummary?.result).toBe("completed");
    expect(state.events.find((event) => event.type === "delegated_execution_mode")).toMatchObject({
      executionMode: "native_governance",
      syntheticEvidence: true
    });
    expect(state.finalSummary?.userReply).toContain("Delegated execution mode:");
  });

  it("uses the Sirius trace completeness rubric for council runs", async () => {
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      siriusConfig(),
      { accessMode: "full", fixtureMode: true }
    );

    expect(state.workflowKind).toBe("sirius_council");
    expect(state.traceCompleteness.score).toBeGreaterThanOrEqual(90);

    const withoutConsensus = state.events.filter((event) => event.type !== "council_consensus");
    const withoutFinalReview = state.events.filter((event) => event.type !== "chief_final_review");

    expect(computeTraceCompleteness(withoutConsensus, { workflowKind: "sirius_council" }).score).toBeLessThan(state.traceCompleteness.score);
    expect(computeTraceCompleteness(withoutFinalReview, { workflowKind: "sirius_council" }).score).toBeLessThan(state.traceCompleteness.score);
  });

  it("projects Sirius governance into the cockpit view model", async () => {
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      siriusConfig(),
      { accessMode: "full", fixtureMode: true }
    );
    const vm = buildCockpitViewModel(process.cwd(), state);

    expect(vm.chiefAgent?.chiefAgentId).toBe("codex");
    expect(vm.council?.members.length).toBeGreaterThanOrEqual(3);
    expect(vm.taskOwnership?.assignments.length).toBeGreaterThanOrEqual(5);
    expect(vm.taskOwnership?.assignments.some((assignment) => assignment.ownerAgentId === "deepseek")).toBe(true);
    expect(vm.taskOwnership?.assignments.some((assignment) => assignment.ownerAgentId === "mimo")).toBe(true);
    expect(vm.policyMutations?.count ?? 0).toBe(0);
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
      { accessMode: "full", fixtureMode: true }
    );
    const externalEvents = state.events.filter((event) => event.type === "external_agent_call" || event.type === "external_agent_result");

    expect(externalEvents.length).toBeGreaterThan(0);
    expect(state.events.some((event) => event.type === "external_agent_result" && event.summary.includes("mock command handled"))).toBe(true);
    expect(state.delegatedTaskResults?.some((result) => result.artifactRefs.some((ref) => ref.includes("external_agent_response")))).toBe(true);
    expect(state.events.find((event) => event.type === "delegated_execution_mode")).toMatchObject({
      executionMode: expect.stringMatching(/external_command|mixed/),
      syntheticEvidence: expect.any(Boolean)
    });
    expect(state.finalChiefReview?.decision).toBe("approve_delivery");
  });

  it("invokes configured chief and council member adapters and marks source fields", async () => {
    const commandConfig = siriusCommandConfig();
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      commandConfig,
      { accessMode: "full", fixtureMode: true }
    );
    const chiefPlan = state.events.find((event) => event.type === "chief_initial_plan");
    const finalReview = state.events.find((event) => event.type === "chief_final_review");
    const councilAgentMoves = state.events.filter((event) => event.type === "council_move" && event.source === "agent");
    const externalCalls = state.events.filter((event) => event.type === "external_agent_call");

    expect(chiefPlan).toMatchObject({ source: "chief_agent" });
    expect(finalReview).toMatchObject({ source: "chief_agent" });
    expect(councilAgentMoves.map((event) => event.speakerAgentId)).toEqual(expect.arrayContaining(["deepseek", "mimo"]));
    expect(externalCalls.some((event) => event.externalAgentId === "codex" && event.role === "planner")).toBe(true);
    expect(externalCalls.some((event) => event.externalAgentId === "codex" && event.role === "judge")).toBe(true);
    expect(externalCalls.some((event) => event.externalAgentId === "deepseek" && event.role === "reviewer")).toBe(true);
    expect(externalCalls.some((event) => event.externalAgentId === "mimo" && event.role === "runner")).toBe(true);
    expect(state.finalChiefReview?.source).toBe("chief_agent");
  });

  it("runs the packaged Sirius mock config with agent-backed chief, council moves, and final review from an outside cwd", async () => {
    const outsideCwd = await mkdtemp(path.join(os.tmpdir(), "tedge-sirius-example-config-"));
    try {
      const relativeConfigPath = path.join("examples", "configs", "sirius-codex-deepseek-mimo.mock.yaml");
      const configPath = path.join(process.cwd(), relativeConfigPath);
      const output = await captureStdout(() =>
        councilRunCommand(process.cwd(), "rewrite this application in Rust", {
          cwd: outsideCwd,
          config: relativeConfigPath,
          headless: true,
          fixtureMode: true,
          accessMode: "full"
        })
      );
      const payload = JSON.parse(output) as {
        sessionId: string;
        configSource: string;
        configPath?: string;
        eventCount?: number;
        eventTypeCounts?: Record<string, number>;
        traceEventSample?: Array<{ type: string; source?: string; speakerAgentId?: string }>;
        chiefAgent?: { id?: string };
        finalChiefReview?: { source?: string };
        traceCompleteness?: { score?: number };
      };
      const record = await loadSession(outsideCwd, payload.sessionId);
      const events = record.state.events;

      expect(payload.configSource).toBe("explicit");
      expect(payload.configPath).toBe(configPath);
      expect(payload.chiefAgent?.id).toBe("codex");
      expect(payload.eventCount).toBe(events.length);
      expect(payload.eventTypeCounts?.chief_initial_plan).toBe(1);
      expect(payload.eventTypeCounts?.chief_final_review).toBe(1);
      expect(payload.eventTypeCounts?.council_move ?? 0).toBeGreaterThan(0);
      expect(payload.traceEventSample?.some((event) => event.type === "chief_initial_plan" && event.source === "chief_agent")).toBe(true);
      expect(payload.traceEventSample?.some((event) => event.type === "council_move" && event.source === "agent")).toBe(true);
      expect(payload.traceEventSample?.some((event) => event.type === "chief_final_review" && event.source === "chief_agent")).toBe(true);
      expect(events.find((event) => event.type === "chief_initial_plan")).toMatchObject({ source: "chief_agent" });
      expect(events.some((event) => event.type === "council_move" && event.source === "agent")).toBe(true);
      expect(events.filter((event) => event.type === "council_move" && event.source === "agent").map((event) => event.speakerAgentId)).toEqual(expect.arrayContaining(["deepseek", "mimo"]));
      expect(events.find((event) => event.type === "chief_final_review")).toMatchObject({ source: "chief_agent" });
      expect(payload.finalChiefReview?.source).toBe("chief_agent");
      expect(payload.traceCompleteness?.score ?? 0).toBeGreaterThanOrEqual(90);
      expect(record.state.traceCompleteness.score).toBeGreaterThanOrEqual(90);
    } finally {
      await rm(outsideCwd, { recursive: true, force: true });
    }
  }, 20_000);

  it("keeps native source when command adapters are not configured", async () => {
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      siriusConfig(),
      { accessMode: "full", fixtureMode: true }
    );
    expect(state.events.find((event) => event.type === "chief_initial_plan")).toMatchObject({ source: "native" });
    expect(state.events.filter((event) => event.type === "council_move").every((event) => event.source === "native")).toBe(true);
    expect(state.finalChiefReview?.source).toBe("native");
  });

  it("does not claim switch_owner_agent when no fallback owner exists", async () => {
    const config = singleChiefOnlyConfig();
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      config,
      { accessMode: "full", fixtureMode: true, simulateFailureTaskId: "rust_cli_structure" }
    );
    const mutation = state.strategyMutations?.[0];

    expect(mutation?.type).toBe("retry_same_owner");
    expect(mutation?.changedOwner).toBe(false);
    expect(mutation?.oldOwnerAgentId).toBe("codex");
    expect(mutation?.newOwnerAgentId).toBe("codex");
    expect(state.events.some((event) => event.type === "strategy_mutation" && event.mutationType === "switch_owner_agent")).toBe(false);
  });

  it("uses fallbackAgents when an owned external delegated task fails", async () => {
    const commandConfig = siriusCommandConfig();
    commandConfig.external_agents.deepseek = {
      ...commandConfig.external_agents.deepseek,
      command: process.execPath,
      args: ["-e", "process.exit(1)"]
    };
    const state = await runAgentCouncilGovernance(
      process.cwd(),
      "rewrite this application in Rust",
      commandConfig,
      { accessMode: "full", fixtureMode: true }
    );
    const reassignment = state.events.find((event) => event.type === "task_ownership_reassignment" && event.taskNodeId === "rust_cli_structure");
    const latestRustResult = [...(state.delegatedTaskResults ?? [])].reverse().find((result) => result.taskNodeId === "rust_cli_structure");

    expect(reassignment).toMatchObject({ oldOwnerAgentId: "deepseek", trigger: "agent_failure" });
    expect(latestRustResult?.status).toBe("success");
    expect(latestRustResult?.ownerAgentId).toBe(reassignment?.type === "task_ownership_reassignment" ? reassignment.newOwnerAgentId : undefined);
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

function siriusCommandConfig(): TomorrowEdgeConfig {
  const config = siriusConfig();
  config.providers.deepseek = { ...config.providers.deepseek, enabled: false };
  config.providers.mimo = { ...config.providers.mimo, enabled: false };
  config.external_agents.codex = {
    ...config.external_agents.codex,
    command: process.execPath,
    args: [path.join(process.cwd(), "tests", "fixtures", "mock-command-agent.mjs")]
  };
  config.external_agents.deepseek = {
    enabled: true,
    name: "DeepSeek mock member",
    transport: "mcp",
    adapter: "generic",
    responseMode: "json",
    strictJson: false,
    workingTreeMode: "patch_proposal",
    normalizationStrictness: "lenient",
    command: process.execPath,
    args: [path.join(process.cwd(), "tests", "fixtures", "mock-command-agent.mjs")],
    cwd: undefined,
    env: {},
    autoStart: false,
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    maxRetries: 0,
    capabilities: ["coding", "patch", "review"],
    roles: ["coder_a", "coder_b", "reviewer"],
    trustLevel: "medium"
  };
  config.external_agents.mimo = {
    enabled: true,
    name: "MiMo mock member",
    transport: "mcp",
    adapter: "generic",
    responseMode: "json",
    strictJson: false,
    workingTreeMode: "patch_proposal",
    normalizationStrictness: "lenient",
    command: process.execPath,
    args: [path.join(process.cwd(), "tests", "fixtures", "mock-command-agent.mjs")],
    cwd: undefined,
    env: {},
    autoStart: false,
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    maxRetries: 0,
    capabilities: ["test", "coding", "long_context"],
    roles: ["runner", "summarizer", "coder_b"],
    trustLevel: "medium"
  };
  config.agent_capabilities = {
    ...config.agent_capabilities,
    deepseek: {
      coding: 0.95,
      patchGeneration: 0.95,
      review: 0.8,
      costTier: "medium",
      trustLevel: "medium",
      allowedRoles: ["coder_a", "coder_b", "reviewer"]
    },
    mimo: {
      testGeneration: 0.9,
      coding: 0.7,
      costTier: "cheap",
      trustLevel: "medium",
      allowedRoles: ["runner", "summarizer", "coder_b"]
    }
  };
  return config;
}

function singleChiefOnlyConfig(): TomorrowEdgeConfig {
  const config = siriusConfig();
  for (const provider of Object.keys(config.providers) as Array<keyof TomorrowEdgeConfig["providers"]>) {
    config.providers[provider] = { ...config.providers[provider], enabled: false };
  }
  config.external_agents.codex = {
    ...config.external_agents.codex,
    enabled: true,
    roles: ["core", "planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "repairer", "summarizer"],
    capabilities: ["core", "planning", "architecture", "review", "judgment", "coding", "patch", "test", "tool_use"]
  };
  config.agent_capabilities = {
    codex: {
      planning: 0.95,
      architecture: 0.95,
      coding: 0.95,
      patchGeneration: 0.9,
      testGeneration: 0.8,
      review: 0.9,
      judging: 0.9,
      costTier: "expensive",
      trustLevel: "high",
      allowedRoles: ["core", "planner", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "repairer", "summarizer"]
    }
  };
  return config;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}
