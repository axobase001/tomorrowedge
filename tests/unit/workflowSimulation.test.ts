import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { runWorkflowSimulation } from "../../src/core/eval/workflowSimulation.js";

describe("workflow simulation", () => {
  it("runs a core-led workflow and saves a report", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-workflow-"));
    try {
      const config: TomorrowEdgeConfig = {
        ...defaultConfig,
        providers: {
          ...defaultConfig.providers,
          mock: { enabled: true, base_url: "" }
        }
      };
      const result = await runWorkflowSimulation(cwd, "simulate agent orchestration", config, {
        providers: ["mock"],
        rounds: 2
      });

      expect(result.corePlan.decomposition.length).toBeGreaterThan(0);
      expect(result.debateRounds).toBe(2);
      expect(result.debate.filter((turn) => turn.round === 2).length).toBeGreaterThan(0);
      expect(result.review.verdict).toBe("accepted");
      expect(result.reportPath).toContain(".tomorrowedge");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks workflow model calls when the debate budget is exceeded", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-workflow-budget-"));
    const originalInputPrice = process.env.MOCK_INPUT_PRICE_PER_MTOK;
    const originalOutputPrice = process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
    process.env.MOCK_INPUT_PRICE_PER_MTOK = "1000";
    process.env.MOCK_OUTPUT_PRICE_PER_MTOK = "1000";
    try {
      const config: TomorrowEdgeConfig = {
        ...defaultConfig,
        debate: { ...defaultConfig.debate, max_cost_usd: 0.001 },
        providers: {
          ...defaultConfig.providers,
          mock: { enabled: true, base_url: "" }
        }
      };
      const result = await runWorkflowSimulation(cwd, "simulate expensive orchestration", config, {
        providers: ["mock"],
        rounds: 2
      });

      expect(result.budgetStatus.status).toBe("blocked");
      expect(result.debate).toEqual([]);
      expect(result.executions).toEqual([]);
      expect(result.review.verdict).toBe("needs_revision");
    } finally {
      if (originalInputPrice === undefined) delete process.env.MOCK_INPUT_PRICE_PER_MTOK;
      else process.env.MOCK_INPUT_PRICE_PER_MTOK = originalInputPrice;
      if (originalOutputPrice === undefined) delete process.env.MOCK_OUTPUT_PRICE_PER_MTOK;
      else process.env.MOCK_OUTPUT_PRICE_PER_MTOK = originalOutputPrice;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reassigns workflow roles to available requested providers", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-workflow-fallback-"));
    const originalKimiKey = process.env.KIMI_TEST_KEY;
    process.env.KIMI_TEST_KEY = "test-key";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "ok", choices: [{ message: { content: "fallback role output with risk and test plan" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    try {
      const config: TomorrowEdgeConfig = {
        ...defaultConfig,
        providers: {
          ...defaultConfig.providers,
          kimi: {
            ...defaultConfig.providers.kimi,
            enabled: true,
            api_key_env: "KIMI_TEST_KEY"
          }
        }
      };
      const result = await runWorkflowSimulation(cwd, "simulate fallback orchestration", config, {
        providers: ["kimi"],
        rounds: 1
      });

      expect(result.assignments.map((assignment) => assignment.provider)).toEqual(["kimi", "kimi", "kimi"]);
      expect([...result.debate, ...result.executions].every((turn) => turn.provider === "kimi")).toBe(true);
      expect(result.review.gaps.join("\n")).not.toContain("Provider unavailable");
    } finally {
      if (originalKimiKey === undefined) delete process.env.KIMI_TEST_KEY;
      else process.env.KIMI_TEST_KEY = originalKimiKey;
      vi.unstubAllGlobals();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("includes enabled external agents in debate and cost governance report", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-workflow-external-"));
    try {
      const config: TomorrowEdgeConfig = {
        ...defaultConfig,
        external_agents: {
          codex: {
            ...defaultConfig.external_agents.codex,
            enabled: true,
            roles: ["reviewer", "judge"],
            capabilities: ["review", "judgment"],
            costProfile: { inputPricePerMTok: 1, outputPricePerMTok: 2 }
          }
        },
        providers: {
          ...defaultConfig.providers,
          mock: { enabled: true, base_url: "" }
        }
      };
      const result = await runWorkflowSimulation(cwd, "simulate external debate", config, {
        providers: ["mock", "codex"],
        rounds: 2
      });
      const report = await readFile(result.reportPath, "utf8");

      expect(result.debate.some((turn) => turn.provider === "external:codex")).toBe(true);
      expect(result.assignments.some((assignment) => assignment.provider === "external:codex")).toBe(true);
      expect(report).toContain("Cost Governance");
      expect(report).toContain("external:codex");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
