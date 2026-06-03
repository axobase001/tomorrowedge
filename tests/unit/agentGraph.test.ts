import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";

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
  });

  it("records live advisory notes without changing deterministic decisions", async () => {
    delete process.env.MOCK_INPUT_PRICE_PER_MTOK;
    delete process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { liveAdvisory: true });

    expect(state.modelNotes.map((note) => note.kind)).toEqual(["plan_advice", "implementation_advice", "review_advice", "judge_advice"]);
    expect(state.modelNotes.every((note) => note.provider === "mock")).toBe(true);
    expect(state.usageSummary.totalTokens).toBeGreaterThan(0);
    expect(state.changedFiles).toEqual([]);
  });

  it("blocks live advisory before model calls when budget is exceeded", async () => {
    process.env.MOCK_INPUT_PRICE_PER_MTOK = "1000";
    process.env.MOCK_OUTPUT_PRICE_PER_MTOK = "1000";
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = { ...defaultConfig, routing: { ...defaultConfig.routing, max_cost_usd: 0.001 } };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.budgetStatus?.status).toBe("blocked");
    expect(state.modelNotes).toEqual([]);
    expect(state.usageSummary.totalTokens).toBe(0);
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
        openrouter: { enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
      }
    };
    const state = await runOfflineGraph(cwd, "fix failing test", config, { liveAdvisory: true });

    expect(state.routing.assignments.find((assignment) => assignment.role === "planner")?.provider).toBe("openrouter");
    expect(state.modelNotes.length).toBeGreaterThan(0);
    expect(state.modelNotes.every((note) => note.provider === "mock")).toBe(true);
    expect(state.modelNotes.every((note) => note.fallbackUsed)).toBe(true);
    expect(state.modelNotes.every((note) => note.fallbackFrom?.provider === "openrouter")).toBe(true);
  });

  it("surfaces unavailable provider errors when routing fallback is disabled", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const config = {
      ...defaultConfig,
      routing: { ...defaultConfig.routing, fallback: false },
      providers: {
        ...defaultConfig.providers,
        openrouter: { enabled: true, api_key_env: "OPENROUTER_API_KEY", base_url: "https://openrouter.ai/api/v1" }
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
      expect(state.finalSummary?.evidence.some((item) => item.includes(state.visualSpec?.summary ?? ""))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
