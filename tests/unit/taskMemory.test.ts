import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import { buildStrategyMemoryHints, compactFailureMemories, deleteFailureMemory, explainFailureMemories, previewLearnedTaskMemory, readFailureMemories, readLearnedTaskMemory, showFailureMemory } from "../../src/core/memory/taskMemory.js";

describe("learned task memory", () => {
  it("records compact reusable task metadata when a session is saved", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-memory-"));
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
      const records = await readLearnedTaskMemory(cwd);

      expect(records[0]?.taskType).toBe("test");
      expect(records[0]?.routingMode).toBe("balanced");
      expect(records[0]?.verificationCommands).toContain("npm test");
      expect(records[0]?.goalFingerprint).toMatch(/^[0-9a-f]+$/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not write failure memory unless consent is explicitly enabled", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-consent-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig);
      state.runResults = [{
        command: "npm test",
        exitCode: 1,
        stdout: "",
        stderr: "AssertionError: expected add(2, 3) to equal 5",
        durationMs: 12,
        success: false
      }];
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

      expect(await readLearnedTaskMemory(cwd, 20, { includeStale: true })).toEqual([]);
      expect(await readFailureMemories(cwd)).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("previews, deletes, and compacts consented failure memory records", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-controls-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig);
      state.runResults = [{
        command: "npm test",
        exitCode: 1,
        stdout: "",
        stderr: "AssertionError: expected add(2, 3) to equal 5",
        durationMs: 12,
        success: false
      }];
      state.finalSummary = {
        task: state.goal,
        result: "failed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command failed: npm test"],
        risksRemaining: ["Verifier failed."],
        suggestedCommitMessage: "fix: retry"
      };

      const preview = await previewLearnedTaskMemory(cwd, state, { failureMemory: { enabled: false, redaction: "artifact_refs" } });
      expect(preview.wouldWrite).toBe(false);
      expect(preview.reason).toBe("failure_memory.disabled");
      expect(preview.record?.failureClass).toBe("validation_failed");

      await saveSession(cwd, state, { failureMemory: { enabled: true, redaction: "metadata_only" } });
      const [failure] = await readFailureMemories(cwd, 20);
      expect(failure.evidenceRefs).toEqual([]);

      const deleted = await deleteFailureMemory(cwd, failure.id);
      expect(deleted).toBe(true);
      expect(await readFailureMemories(cwd, 20, { includeStale: true })).toEqual([]);

      await saveSession(cwd, state, { failureMemory: { enabled: true, redaction: "metadata_only" } });
      const compacted = await compactFailureMemories(cwd, { limit: 1 });
      expect(compacted.after).toBe(1);
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
      await saveSession(cwd, state, { failureMemory: { enabled: true, redaction: "artifact_refs" } });
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
      const state = await runOfflineGraph(cwd, "fix failing test in C:\\Users\\PC\\secret\\repo with OPENROUTER_API_KEY=sk-123456789012345678901234", defaultConfig);
      state.runResults = [
        {
          command: "npm test",
          exitCode: 1,
          stdout: "short output",
          stderr: "AssertionError at C:\\Users\\PC\\secret\\repo\\index.js: expected add(2, 3) to equal 5",
          durationMs: 12,
          success: false
        }
      ];
      state.eventArtifacts = [{ ref: "artifacts/stderr.txt", content: "OPENROUTER_API_KEY=sk-123456789012345678901234\nAssertionError" }];
      state.events = [{
        id: "event_prediction_sensitive",
        timestamp: "2026-06-07T00:00:00.000Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "outcome_prediction",
        phase: "shell",
        role: "runner",
        target: "shell",
        command: "npm test",
        predictedOutcome: "passed",
        expectedBehavior: "Validate selected patch.",
        expectedTestOutcome: "npm test should pass.",
        uncertainty: "medium",
        predictionRef: "artifacts/predictions/prediction.json"
      }, {
        id: "event_shell_sensitive",
        timestamp: "2026-06-07T00:00:00.000Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "shell_run",
        phase: "shell",
        role: "runner",
        command: "npm test",
        cwd,
        success: false,
        exitCode: 1,
        stderrRef: "C:\\Users\\PC\\secret\\repo\\.tomorrowedge\\artifacts\\stderr.txt"
      }, {
        id: "event_observation_sensitive",
        timestamp: "2026-06-07T00:00:00.001Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "outcome_observation",
        phase: "shell",
        role: "runner",
        target: "shell",
        predictionEventId: "event_prediction_sensitive",
        command: "npm test",
        predictedOutcome: "passed",
        observedOutcome: "failed",
        matched: false,
        mismatchType: "wrong_assumption",
        summary: "Command failed: npm test",
        observationRef: "artifacts/observations/observation.json"
      }];
      state.finalSummary = {
        task: state.goal,
        result: "failed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command failed: npm test"],
        risksRemaining: ["Verifier failed."],
        suggestedCommitMessage: "fix: retry"
      };
      await saveSession(cwd, state, { failureMemory: { enabled: true, redaction: "artifact_refs" } });

      const [record] = await readFailureMemories(cwd);

      expect(record.failureClass).toBe("validation_failed");
      expect(record.schemaVersion).toBe("task-memory/v2");
      expect(record.failureSignature).toMatch(/^[0-9a-f]{64}$/);
      expect(record.recurrenceCount).toBe(1);
      expect(record.fixedCount).toBe(0);
      expect(record.sourceSessionIds).toEqual([state.sessionId]);
      expect(record.failureMemoryConsent).toBe("enabled");
      expect(record.failureMemoryRedaction).toBe("artifact_refs");
      expect(record.correction).toContain("npm test");
      expect(record.outcomePredictionRefs).toEqual(["event_prediction_sensitive"]);
      expect(record.outcomeObservationRefs).toEqual(["event_observation_sensitive"]);
      expect(record.outcomeMismatchType).toBe("wrong_assumption");
      expect(record.predictionAccuracy).toEqual({ matched: 0, total: 1 });
      expect(record.evidenceRefs).toContain("artifacts/stderr.txt");
      expect(record.evidenceRefs).toContain("artifacts/predictions/prediction.json");
      expect(record.evidenceRefs).toContain("artifacts/observations/observation.json");
      expect(record.evidenceRefs).toContain("[path]");
      expect(record.goalPreview).not.toContain("sk-");
      expect(JSON.stringify(record)).not.toContain("123456789012345678901234");
      expect(JSON.stringify(record)).not.toContain("C:\\Users\\PC");
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

      await saveSession(cwd, first, { failureMemory: { enabled: true, redaction: "artifact_refs" } });
      await saveSession(cwd, second, { failureMemory: { enabled: true, redaction: "artifact_refs" } });

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
      await saveSession(cwd, state, { failureMemory: { enabled: true, redaction: "artifact_refs", retentionDays: 1 } });

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
      await saveSession(cwd, state, { failureMemory: { enabled: true, redaction: "artifact_refs" } });

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
