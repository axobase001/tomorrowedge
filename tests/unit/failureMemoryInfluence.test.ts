import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";

describe("failure memory workflow influence", () => {
  it("injects retrieved failure memories into planner, coder, reviewer, and judge flow", async () => {
    const cwd = await fixtureWorkspace("tedge-memory-influence-");
    try {
      await seedValidationFailureMemory(cwd);
      const state = await runOfflineGraph(cwd, "fix npm test failure in index.js", memoryEnabledConfig(), { provider: "fixture" });

      expect(state.failureMemory?.premortem?.selectedMemoryIds.length).toBeGreaterThan(0);
      expect(state.plan?.constraints.some((constraint) => constraint.includes("Memory pre-mortem"))).toBe(true);
      expect(state.candidates[0]?.knownTradeoffs.some((item) => item.includes("Memory constraint"))).toBe(true);
      expect(state.review?.reviews[0]?.memoryIds?.length).toBeGreaterThan(0);
      expect(state.review?.reviews[0]?.memoryAlignment?.length).toBeGreaterThan(0);
      expect(state.judge?.reason).toContain("Memory guard checked");
      expect(state.events.some((event) => event.type === "memory_retrieval" && event.retrievalStage === "premortem")).toBe(true);
      expect(state.events.some((event) => event.type === "memory_retrieval" && event.retrievalStage === "coder_constraints")).toBe(true);
      expect(state.events.some((event) => event.type === "memory_retrieval" && event.retrievalStage === "review_guard")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("retrieves prior corrections for repair attempts after validation failure", async () => {
    const cwd = await fixtureWorkspace("tedge-memory-repair-");
    try {
      await seedValidationFailureMemory(cwd);
      const state = await runOfflineGraph(cwd, "fix failing test", memoryEnabledConfig(), {
        provider: "fixture",
        approvePatch: true,
        approveShell: true,
        approveRepair: true,
        repairOnFail: true,
        fixtureFailingPatch: true
      });

      expect(state.failureMemory?.repairContext?.selectedMemoryIds.length).toBeGreaterThan(0);
      expect(state.repairCandidates[0]?.knownTradeoffs.some((item) => item.includes("Retrieved repair correction"))).toBe(true);
      expect(state.events.some((event) => event.type === "memory_retrieval" && event.retrievalStage === "repair_context")).toBe(true);
      expect(state.runResults.map((result) => result.success)).toEqual([false, true]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function fixtureWorkspace(prefix: string): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), prefix));
  await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
  return cwd;
}

async function seedValidationFailureMemory(cwd: string): Promise<void> {
  const state = await runOfflineGraph(cwd, "repair npm test validation failure in index.js", defaultConfig, { provider: "fixture" });
  state.runResults = [
    {
      command: "npm test",
      exitCode: 1,
      stdout: "",
      stderr: "AssertionError: expected add(2, 3) to equal 5",
      durationMs: 5,
      success: false
    }
  ];
  state.finalSummary = {
    task: state.goal,
    result: "failed",
    changedFiles: ["index.js"],
    testsRun: ["npm test"],
    evidence: ["Command failed: npm test"],
    risksRemaining: ["Verifier failed."],
    suggestedCommitMessage: "fix: test"
  };
  await saveSession(cwd, state);
}

function memoryEnabledConfig(): typeof defaultConfig {
  return {
    ...defaultConfig,
    strategy_memory: {
      ...defaultConfig.strategy_memory,
      enabled: true
    }
  };
}
