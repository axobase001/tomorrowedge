import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { clearContextCaches } from "../../src/core/context/contextCache.js";

describe("offline agent graph", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    delete process.env.MOCK_INPUT_PRICE_PER_MTOK;
    delete process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
    if (originalOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    }
  });

  it("runs without external providers", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test without changing schema", defaultConfig);
    expect(state.plan?.constraints[0]).toContain("Without");
    expect(state.candidates.length).toBe(2);
    expect(state.review).toBeTruthy();
    expect(state.debateRounds.length).toBeGreaterThan(0);
    expect(state.judge?.decision).toBe("request_revision");
    expect(state.finalSummary?.evidence).toContain("offline graph completed");
    expect(state.evidencePackets.length).toBeGreaterThan(0);
    expect(state.providerViews.length).toBeGreaterThan(0);
    expect(state.traceCompleteness?.score).toBeGreaterThan(0);
    expect(state.routing.assignments.some((assignment) => assignment.role === "vision")).toBe(false);
    expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "routing_decision",
      "budget_preview",
      "artifact_projection",
      "context_projection",
      "evidence_packet",
      "workflow_stop_reason",
      "trace_completeness"
    ]));
  });

  it("starts alternative coder candidates in the same candidate-production stage", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
    const coderA = state.agents.find((agent) => agent.role === "coder_a");
    const coderB = state.agents.find((agent) => agent.role === "coder_b");

    expect(coderA?.status).toBe("success");
    expect(coderB?.status).toBe("success");
    expect(Math.abs(Date.parse(coderA!.startedAt!) - Date.parse(coderB!.startedAt!))).toBeLessThan(50);
    expect(state.candidates.map((candidate) => candidate.agentId).slice(0, 2)).toEqual(["coder_a", "coder_b"]);
  });

  it("reuses planner and explorer results while invalidating explorer on repo changes", async () => {
    clearContextCaches();
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-context-cache-"));
    await cp(source, cwd, { recursive: true });
    try {
      await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const second = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      await writeFile(path.join(cwd, "index.js"), "export function add(a, b) { return a + b; }\n// cache invalidation\n", "utf8");
      const third = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });

      expect(second.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "planner", status: "hit" }));
      expect(second.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "explorer", status: "hit" }));
      expect(third.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "planner", status: "hit" }));
      expect(third.events).toContainEqual(expect.objectContaining({ type: "agent_cache", cache: "explorer", status: "miss" }));
    } finally {
      clearContextCaches();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps read-only directory inspection out of patch approval", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-readonly-"));
    await mkdir(path.join(cwd, "quantum", "src"), { recursive: true });
    await writeFile(path.join(cwd, "quantum", "README.md"), "# Quantum\n", "utf8");
    await writeFile(path.join(cwd, "quantum", "src", "index.ts"), "export const value = 1;\n", "utf8");
    try {
      const state = await runOfflineGraph(cwd, "读取 quantum 文件夹内容，输出文件结构", defaultConfig, { fixtureMode: true });
      const eventTypes = state.events.map((event) => event.type);

      expect(state.plan?.taskType).toBe("analysis");
      expect(state.finalSummary?.result).toBe("completed");
      expect(state.finalSummary?.evidence.join("\n")).toContain("quantum/");
      expect(state.finalSummary?.evidence.join("\n")).toContain("src/");
      expect(state.events.find((event) => event.type === "workflow_intent")).toMatchObject({
        intent: "inspect",
        requiresPatchWorkflow: false
      });
      expect(state.candidates).toEqual([]);
      expect(state.review).toBeUndefined();
      expect(state.judge).toBeUndefined();
      expect(state.agents.some((agent) => agent.status === "waiting_for_user")).toBe(false);
      expect(eventTypes).toContain("context_select");
      expect(eventTypes).not.toContain("patch_candidate");
      expect(eventTypes).not.toContain("review_decision");
      expect(eventTypes).not.toContain("judge_decision");
      expect(eventTypes).not.toContain("patch_apply");
      expect(state.events.find((event) => event.type === "workflow_stop_reason")).toMatchObject({
        reason: "read-only request completed without patch workflow"
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps natural-language inspect requests from becoming fake missing paths", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "inspect provider setup flow for actionable bug; do not edit files", defaultConfig, { fixtureMode: true });
    const evidence = state.finalSummary?.evidence.join("\n") ?? "";

    expect(state.plan?.taskType).toBe("analysis");
    expect(state.finalSummary?.result).toBe("completed");
    expect(evidence).toContain("Read-only request completed without patch generation.");
    expect(evidence).not.toContain(`${cwd}${path.sep}provider`);
    expect(evidence).not.toContain("Unable to inspect target");
    expect(evidence).not.toContain("ENOENT");
    expect(state.candidates).toEqual([]);
  });

  it("separates configured cloud route proposals from native offline execution", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      debate: { ...defaultConfig.debate, max_candidates: 1 },
      providers: {
        ...defaultConfig.providers,
        deepseek: {
          ...defaultConfig.providers.deepseek,
          enabled: true,
          base_url: "https://api.deepseek.example/v1",
          api_key_env: "",
          auth_header: "none" as const
        }
      },
      agents: {
        ...defaultConfig.agents,
        planner: { provider: "deepseek", model: "deepseek-v4-pro" },
        coder_a: { provider: "deepseek", model: "deepseek-v4-pro" },
        reviewer: { provider: "deepseek", model: "deepseek-v4-pro" },
        judge: { provider: "deepseek", model: "deepseek-v4-pro" }
      }
    };

    const state = await runOfflineGraph(cwd, "fix failing test", config);
    const agentKinds = new Map(state.agents.map((agent) => [agent.role, agent.agentKind]));
    const plannerRoute = state.routing.assignments.find((assignment) => assignment.role === "planner");
    expect(plannerRoute).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(agentKinds.get("planner")).toBe("offline");
    expect(agentKinds.get("coder_a")).toBe("offline");
    expect(agentKinds.get("reviewer")).toBe("offline");
    expect(agentKinds.get("judge")).toBe("offline");
    expect(state.events.find((event) => event.type === "agent_run" && event.role === "planner")).toMatchObject({ agentKind: "offline" });
  });

  it("lets configured external MCP agents execute core-led workflow roles", async () => {
    const source = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-external-core-"));
    await cp(source, cwd, { recursive: true });
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
          roles: ["core", "coder_a", "reviewer", "judge"],
          capabilities: ["core", "coding", "review", "judgment"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        core: { provider: "external:codex", model: "auto" },
        coder_a: { provider: "external:codex", model: "auto" },
        reviewer: { provider: "external:codex", model: "auto" },
        judge: { provider: "external:codex", model: "auto" }
      }
    };

    try {
      const state = await runOfflineGraph(cwd, "fix failing test", config, {
        accessMode: "partial",
        approvePatch: true,
        approveShell: true,
        testCommand: "node test.js"
      });

      expect(state.agents.filter((agent) => agent.provider === "external:codex").map((agent) => agent.role)).toEqual(expect.arrayContaining(["core", "coder_a", "reviewer", "judge"]));
      expect(state.candidates[0]?.candidateId).toBe("external_codex_patch");
      expect(state.review?.overallRecommendation).toContain("External reviewer accepts");
      expect(state.judge?.selectedCandidateId).toBe("external_codex_patch");
      expect(state.changedFiles).toEqual(["index.js"]);
      expect(state.runResults[0]?.success).toBe(true);
      expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining(["external_agent_call", "external_agent_result", "patch_apply", "shell_run"]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 15_000);

  it("records unparseable external role payloads before falling back to native agents", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      external_agents: {
        ...defaultConfig.external_agents,
        codex: {
          ...defaultConfig.external_agents.codex,
          enabled: true,
          command: process.execPath,
          args: [path.join(process.cwd(), "tests", "fixtures", "mock-role-external-mcp-server.mjs")],
          env: { TOMORROWEDGE_UNPARSEABLE_ROLE: "reviewer" },
          autoStart: true,
          roles: ["reviewer"],
          capabilities: ["review"],
          requestTimeoutMs: 10_000
        }
      },
      agents: {
        ...defaultConfig.agents,
        reviewer: { provider: "external:codex", model: "auto" }
      }
    };

    const state = await runOfflineGraph(cwd, "fix failing test", config);
    const fallbackEvent = state.events.find((event) => event.type === "external_agent_error" && event.role === "reviewer");

    expect(state.review?.overallRecommendation).toBeTruthy();
    expect(fallbackEvent).toBeTruthy();
    expect(fallbackEvent && "error" in fallbackEvent ? fallbackEvent.error : "").toContain("falling back to native reviewer");
  });

  it("records live advisory notes without changing deterministic decisions", async () => {
    delete process.env.MOCK_INPUT_PRICE_PER_MTOK;
    delete process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { liveAdvisory: true });

    expect(state.modelNotes.map((note) => note.kind)).toEqual(["review_advice", "judge_advice", "plan_advice", "implementation_advice", "review_advice", "judge_advice"]);
    expect(state.modelNotes.every((note) => note.provider === "mock")).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "reviewer" && round.evidence.some((item) => item.includes("direct model stance")))).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "judge" && round.evidence.some((item) => item.includes("direct model stance")))).toBe(true);
    expect(state.usageSummary.totalTokens).toBeGreaterThan(0);
    expect(state.changedFiles).toEqual([]);
    expect(state.events.some((event) => event.type === "budget_decision" && event.role === "planner" && event.status !== "blocked")).toBe(true);
  });

  it("blocks live advisory before model calls when budget is exceeded", async () => {
    process.env.MOCK_INPUT_PRICE_PER_MTOK = "1000";
    process.env.MOCK_OUTPUT_PRICE_PER_MTOK = "1000";
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = { ...defaultConfig, routing: { ...defaultConfig.routing, max_cost_usd: 0.001 } };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.budgetStatus?.status).toBe("blocked");
    expect(state.budgetStatuses.map((status) => status.status)).toContain("blocked");
    expect(state.modelNotes).toEqual([]);
    expect(state.usageSummary.totalTokens).toBe(0);
    expect(state.events.some((event) => event.type === "budget_decision" && event.status === "blocked")).toBe(true);
  });

  it("restricted access blocks live advisory before cloud/model calls", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, {
      liveAdvisory: true,
      accessMode: "restricted"
    });

    expect(state.access.cloudAllowed).toBe(false);
    expect(state.budgetStatus?.status).toBe("blocked");
    expect(state.modelNotes).toEqual([]);
  });

  it("falls back to mock when a routed live advisory provider is unavailable", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.routing.assignments.find((assignment) => assignment.role === "planner")?.provider).toBe("openrouter");
    expect(state.modelNotes.length).toBeGreaterThan(0);
    expect(state.modelNotes.every((note) => note.provider === "mock")).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "reviewer" && round.evidence.some((item) => item.includes("provider=mock/")))).toBe(true);
    expect(state.debateRounds.some((round) => round.speaker === "judge" && round.evidence.some((item) => item.includes("provider=mock/")))).toBe(true);
    expect(state.modelNotes.every((note) => note.fallbackUsed)).toBe(true);
    expect(state.modelNotes.every((note) => note.fallbackFrom?.provider === "openrouter")).toBe(true);
    expect(state.events.some((event) => event.type === "provider_fallback")).toBe(true);
    expect(state.events.some((event) => event.type === "model_call" && event.status === "start" && event.provider === "openrouter")).toBe(true);
    expect(state.events.some((event) => event.type === "model_call" && event.status === "failure" && event.provider === "openrouter")).toBe(true);
    expect(state.events.some((event) => event.type === "model_call" && event.status === "success" && event.provider === "mock")).toBe(true);
  });

  it("surfaces unavailable provider errors when routing fallback is disabled", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, fallback: false },
      providers: {
        ...defaultConfig.providers,
        openrouter: { ...defaultConfig.providers.openrouter, enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.modelNotes.length).toBeGreaterThan(0);
    expect(state.modelNotes.every((note) => note.provider === "openrouter")).toBe(true);
    expect(state.modelNotes.every((note) => note.fallbackUsed !== true)).toBe(true);
    expect(state.modelNotes.every((note) => note.error?.includes("not configured"))).toBe(true);
  });

  it("records live patch candidate attempts without applying them", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { livePatch: true });

    expect(state.candidates.length).toBeGreaterThan(2);
    expect(state.modelNotes.filter((note) => note.kind === "patch_generation").length).toBe(2);
    expect(state.changedFiles).toEqual([]);
    expect(state.events.some((event) => event.type === "budget_decision" && event.role === "coder_a" && event.phase === "coding")).toBe(true);
    expect(state.events.some((event) => event.type === "budget_decision" && event.role === "coder_b" && event.phase === "coding")).toBe(true);
  });

  it("restricted access blocks live patch generation", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { livePatch: true, accessMode: "restricted" });

    expect(state.budgetStatus?.status).toBe("blocked");
    expect(state.modelNotes.filter((note) => note.kind === "patch_generation")).toEqual([]);
  });

  it("inserts a vision handoff when image inputs are provided", async () => {
    const cwd = path.join(os.tmpdir(), `tedge-vision-${Date.now()}`);
    const imagePath = path.join(cwd, "login-screen.png");
    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(imagePath, "fake image bytes", "utf8");
      const state = await runOfflineGraph(cwd, "restore this mobile login React page from screenshot", defaultConfig, {
        imagePaths: [imagePath]
      });

      expect(state.agents[0].role).toBe("vision");
      expect(state.capabilityRoute?.trigger).toBe("image_input");
      expect(state.capabilityRoute?.steps.map((step) => step.role)).toContain("vision");
      expect(state.visualSpec?.pageType).toBe("ui_screen");
      expect(state.visualSpec?.handoffPrompt).toContain("Visual Spec");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "planner")?.status).toBe("success");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "coder_a")?.status).toBe("success");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "reviewer")?.status).toBe("success");
      expect(state.finalSummary?.evidence.some((item) => item.includes(state.visualSpec?.summary ?? ""))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps a visual handoff when live vision cannot produce structured JSON", async () => {
    const cwd = path.join(os.tmpdir(), `tedge-live-vision-${Date.now()}`);
    const imagePath = path.join(cwd, "error.png");
    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(imagePath, "fake image bytes", "utf8");
      const state = await runOfflineGraph(cwd, "fix the bug shown in this error screenshot", defaultConfig, {
        imagePaths: [imagePath],
        liveVision: true
      });

      expect(state.modelNotes.some((note) => note.kind === "vision_spec")).toBe(true);
      expect(state.visualSpec?.pageType).toBe("error_screenshot");
      expect(state.capabilityRoute?.steps.find((step) => step.role === "vision")?.status).toBe("success");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails before visual handoff when image input is missing", async () => {
    const cwd = path.join(os.tmpdir(), `tedge-live-vision-missing-${Date.now()}`);
    const imagePath = path.join(cwd, "missing-error.png");
    try {
      await mkdir(cwd, { recursive: true });
      await expect(runOfflineGraph(cwd, "fix the bug shown in this error screenshot", defaultConfig, {
        imagePaths: [imagePath],
        liveVision: true
      })).rejects.toThrow("Image input not found");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("includes image inputs in live vision budget preflight", async () => {
    process.env.MOCK_INPUT_PRICE_PER_MTOK = "1000";
    process.env.MOCK_OUTPUT_PRICE_PER_MTOK = "1000";
    const cwd = path.join(os.tmpdir(), `tedge-live-vision-budget-${Date.now()}`);
    const imagePath = path.join(cwd, "screen.png");
    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(imagePath, "fake image bytes", "utf8");
      const config = { ...defaultConfig, routing: { ...defaultConfig.routing, max_cost_usd: 0.001 } };
      const state = await runOfflineGraph(cwd, "restore this page from screenshot", config, {
        imagePaths: [imagePath],
        liveVision: true
      });

      expect(state.budgetStatus?.status).toBe("blocked");
      expect(state.budgetStatus?.estimatedInputTokens).toBeGreaterThan(1000);
      expect(state.modelNotes.find((note) => note.kind === "vision_spec")).toBeUndefined();
      expect(state.visualSpec?.pageType).toBe("ui_screen");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
