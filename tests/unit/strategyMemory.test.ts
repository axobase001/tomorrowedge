import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TomorrowEdgeConfig } from "../../src/config/schema.js";
import { buildStrategyMemoryRouting } from "../../src/core/memory/strategyMemory.js";
import { ModelRouter } from "../../src/core/routing/router.js";
import type { LearnedTaskMemory } from "../../src/core/memory/taskMemory.js";

describe("strategy memory routing", () => {
  it("summarizes stable routes, blocked providers, and preferred tests for matching tasks", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-strategy-memory-"));
    try {
      await mkdir(path.join(cwd, ".tomorrowedge"), { recursive: true });
      const records: LearnedTaskMemory[] = [
        memoryRecord({
          verificationCommands: ["npm run unit"],
          providerOutcomes: [
            { role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", status: "failure", errorCategory: "rate_limited" },
            { role: "reviewer", provider: "deepseek", model: "deepseek-chat", status: "success" },
            { role: "coder_a", provider: "deepseek", model: "deepseek-chat", status: "success" }
          ]
        }),
        memoryRecord({
          verificationCommands: ["npm run unit", "npm test"],
          providerOutcomes: [
            { role: "reviewer", provider: "deepseek", model: "deepseek-chat", status: "success" },
            { role: "coder_a", provider: "deepseek", model: "deepseek-chat", status: "success" }
          ]
        })
      ];
      await writeFile(path.join(cwd, ".tomorrowedge", "task-memory.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
      const config: TomorrowEdgeConfig = {
        ...defaultConfig,
        memory: { strategy_routing: true, history_limit: 20 },
        providers: {
          ...defaultConfig.providers,
          openrouter: { ...defaultConfig.providers.openrouter, enabled: true, model: "openai/gpt-5.2" },
          deepseek: { ...defaultConfig.providers.deepseek, enabled: true, base_url: "https://api.deepseek.com", model: "deepseek-chat" }
        }
      };

      const summary = await buildStrategyMemoryRouting(cwd, "fix failing test", config);
      const router = new ModelRouter(config, { routeOverrides: summary.routeOverrides });

      expect(summary.enabled).toBe(true);
      expect(summary.avoid).toContainEqual({ role: "reviewer", provider: "openrouter", model: "openai/gpt-5.2", errorCategory: "rate_limited" });
      expect(summary.preferredTestCommands[0]).toBe("npm run unit");
      expect(router.assignmentFor("reviewer")).toMatchObject({ provider: "deepseek", model: "deepseek-chat" });
      expect(router.assignmentFor("reviewer").reason).toContain("strategy memory");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function memoryRecord(partial: Partial<LearnedTaskMemory>): LearnedTaskMemory {
  return {
    createdAt: new Date().toISOString(),
    goalFingerprint: "deadbeef",
    taskType: "test",
    riskLevel: "low",
    routingMode: "balanced",
    accessMode: "partial",
    constraints: [],
    verificationCommands: [],
    judgeDecision: "select",
    result: "completed",
    ...partial
  };
}
