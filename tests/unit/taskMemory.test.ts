import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      expect(record.schemaVersion).toBe("task-memory/v2");
      expect(record.failureSignature).toMatch(/^[0-9a-f]{64}$/);
      expect(record.recurrenceCount).toBe(1);
      expect(record.fixedCount).toBe(0);
      expect(record.sourceSessionIds).toEqual([state.sessionId]);
      expect(record.correction).toContain("npm test");
      expect(record.evidenceRefs).toContain("artifacts/stderr.txt");
      expect(record.goalPreview).not.toContain("sk-");
      expect(JSON.stringify(record)).not.toContain("123456789012345678901234");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("deduplicates repeated failure memories and increments recurrence", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-dedupe-"));
    try {
      const first = await runOfflineGraph(cwd, "repair npm test validation failure in index.js", defaultConfig);
      first.runResults = [
        {
          command: "npm test",
          exitCode: 1,
          stdout: "",
          stderr: "AssertionError: expected add(2, 3) to equal 5",
          durationMs: 5,
          success: false
        }
      ];
      first.finalSummary = {
        task: first.goal,
        result: "failed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command failed: npm test"],
        risksRemaining: [],
        suggestedCommitMessage: "fix: test"
      };
      const second = await runOfflineGraph(cwd, "repair npm test validation failure in index.js", defaultConfig);
      second.runResults = first.runResults;
      second.finalSummary = {
        task: second.goal,
        result: "failed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command failed: npm test"],
        risksRemaining: [],
        suggestedCommitMessage: "fix: test"
      };

      await saveSession(cwd, first);
      await saveSession(cwd, second);

      const failures = await readFailureMemories(cwd, 20);

      expect(failures).toHaveLength(1);
      expect(failures[0]?.recurrenceCount).toBe(2);
      expect(failures[0]?.recurrence).toBe(2);
      expect(failures[0]?.sourceSessionIds).toEqual(expect.arrayContaining([first.sessionId, second.sessionId]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("marks stale failure memories as rejected retrieval evidence", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-stale-"));
    try {
      const state = await runOfflineGraph(cwd, "fix npm test failure in index.js", defaultConfig);
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

      const memoryPath = path.join(cwd, ".tomorrowedge", "task-memory.jsonl");
      const rows = (await readFile(memoryPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
      rows[0].createdAt = "2000-01-01T00:00:00.000Z";
      rows[0].firstSeen = "2000-01-01T00:00:00.000Z";
      rows[0].lastSeen = "2000-01-01T00:00:00.000Z";
      await writeFile(memoryPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

      const visibleFailures = await readFailureMemories(cwd, 20);
      const allFailures = await readFailureMemories(cwd, 20, { includeStale: true });
      const explanation = await explainFailureMemories(cwd, "fix npm test failure in index.js");

      expect(visibleFailures).toEqual([]);
      expect(allFailures[0]?.stale).toBe(true);
      expect(allFailures[0]?.staleReason).toContain("TTL");
      expect(explanation.selected).toEqual([]);
      expect(explanation.rejected[0]?.reason).toContain("stale");
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
