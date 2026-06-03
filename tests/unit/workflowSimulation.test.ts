import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
});
