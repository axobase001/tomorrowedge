import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import { buildStrategyMemoryHints, explainFailureMemories, readFailureMemories, readLearnedTaskMemory, showFailureMemory } from "../../src/core/memory/taskMemory.js";

describe("learned task memory", () => {
  it("records compact reusable task metadata when a session is saved", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-memory-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig);
      await saveSession(cwd, state);
      const records = await readLearnedTaskMemory(cwd);

      expect(records[0]?.taskType).toBe("test");
      expect(records[0]?.routingMode).toBe("balanced");
      expect(records[0]?.verificationCommands).toContain("npm test");
      expect(records[0]?.goalFingerprint).toMatch(/^[0-9a-f]+$/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("builds opt-in strategy memory hints from completed sessions", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-strategy-memory-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig);
      state.finalSummary = {
        task: state.goal,
        result: "completed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command passed: npm test"],
        risksRemaining: [],
        suggestedCommitMessage: "fix: test"
      };
      await saveSession(cwd, state);
      const hints = await buildStrategyMemoryHints(cwd);

      expect(hints.sourceRecords).toBe(1);
      expect(hints.preferredTestCommand).toBe("npm test");
      expect(hints.routeAssignments.some((route) => route.role === "planner" && route.reason.includes("strategy memory"))).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("stores structured failure memory without bulky raw artifacts", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-memory-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test with OPENROUTER_API_KEY=sk-123456789012345678901234", defaultConfig);
      state.runResults = [
        {
          command: "npm test",
          exitCode: 1,
          stdout: "short output",
          stderr: "AssertionError: expected add(2, 3) to equal 5",
          durationMs: 12,
          success: false
        }
      ];
      state.eventArtifacts = [{ ref: "artifacts/stderr.txt", content: "OPENROUTER_API_KEY=sk-123456789012345678901234\nAssertionError" }];
      state.finalSummary = {
        task: state.goal,
        result: "failed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command failed: npm test"],
        risksRemaining: ["Verifier failed."],
        suggestedCommitMessage: "fix: retry"
      };
      await saveSession(cwd, state);

      const [record] = await readFailureMemories(cwd);

      expect(record.failureClass).toBe("validation_failed");
      expect(record.correction).toContain("npm test");
      expect(record.evidenceRefs).toContain("artifacts/stderr.txt");
      expect(record.goalPreview).not.toContain("sk-");
      expect(JSON.stringify(record)).not.toContain("123456789012345678901234");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("shows and explains selected failure memories with reasons", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-explain-"));
    try {
      const state = await runOfflineGraph(cwd, "repair npm test validation failure in index.js", defaultConfig);
      state.runResults = [
        {
          command: "npm test",
          exitCode: 1,
          stdout: "",
          stderr: "test failed",
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
        risksRemaining: [],
        suggestedCommitMessage: "fix: test"
      };
      await saveSession(cwd, state);

      const [failure] = await readFailureMemories(cwd);
      const shown = await showFailureMemory(cwd, failure.id);
      const explanation = await explainFailureMemories(cwd, "fix npm test failure in index.js");

      expect(shown?.id).toBe(failure.id);
      expect(explanation.selected[0]?.id).toBe(failure.id);
      expect(explanation.selected[0]?.matchedSignals).toContain("npm");
      expect(explanation.rejected).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
