import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { saveSession } from "../../src/core/memory/sessionMemory.js";
import { appendLearnedTaskMemory, buildStrategyMemoryHints, compactFailureMemories, deleteFailureMemory, explainFailureMemories, previewLearnedTaskMemory, readFailureMemories, readLearnedTaskMemory, showFailureMemory } from "../../src/core/memory/taskMemory.js";
import { memoryCommand } from "../../src/cli/commands/memory.js";
import { saveProjectPreferences } from "../../src/core/memory/preferences.js";

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

      expect(records[0]?.taskType).toBe("bugfix");
      expect(records[0]?.secondarySignals).toEqual(["test_failure"]);
      expect(records[0]?.routingMode).toBe("balanced");
      expect(records[0]?.verificationCommands).toContain("npm test");
      expect(records[0]?.goalFingerprint).toMatch(/^[0-9a-f]+$/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("serializes concurrent learned task memory appends", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-memory-concurrent-"));
    try {
      const base = await runOfflineGraph(cwd, "summarize project structure", defaultConfig);
      const expectedGoals = Array.from({ length: 16 }, (_, index) => `preserve concurrent memory record ${index}`);

      await Promise.all(expectedGoals.map((goal, index) => appendLearnedTaskMemory(cwd, {
        ...base,
        sessionId: `session_memory_${index}`,
        goal,
        runResults: [],
        finalSummary: {
          task: goal,
          result: "completed",
          changedFiles: [`file-${index}.ts`],
          testsRun: ["npm test"],
          evidence: ["Command passed: npm test"],
          risksRemaining: [],
          suggestedCommitMessage: "fix: test"
        }
      })));

      const records = await readLearnedTaskMemory(cwd, 50, { newestFirst: false, includeStale: true });

      expect(records).toHaveLength(expectedGoals.length);
      expect(records.map((record) => record.goalPreview).sort()).toEqual([...expectedGoals].sort());
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

  it("normalizes stored task type for failing-test repair and pure test-authoring tasks", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-type-normalize-"));
    try {
      const failingState = await runOfflineGraph(cwd, "repair failing unit test caused by implementation bug", defaultConfig);
      failingState.finalSummary = {
        task: failingState.goal,
        result: "completed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command passed: npm test"],
        risksRemaining: [],
        suggestedCommitMessage: "fix: implementation bug"
      };
      await saveSession(cwd, failingState);

      const testState = await runOfflineGraph(cwd, "add tests for parser", defaultConfig);
      testState.finalSummary = {
        task: testState.goal,
        result: "completed",
        changedFiles: ["parser.test.ts"],
        testsRun: ["npm test"],
        evidence: ["Added parser coverage."],
        risksRemaining: [],
        suggestedCommitMessage: "test: add parser coverage"
      };
      await saveSession(cwd, testState);

      const records = await readLearnedTaskMemory(cwd, 20, { newestFirst: false });

      expect(records[0]?.taskType).toBe("bugfix");
      expect(records[0]?.secondarySignals).toEqual(["test_failure"]);
      expect(records[1]?.taskType).toBe("test");
      expect(records[1]?.secondarySignals ?? []).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("records provider failure outcomes in learned task memory previews", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-provider-outcome-"));
    try {
      const state = await runOfflineGraph(cwd, "summarize code with a live planner", defaultConfig);
      state.events = [{
        id: "event_model_call_rate_limit",
        timestamp: "2026-06-07T00:00:00.000Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "model_call",
        phase: "planning",
        role: "planner",
        provider: "openrouter",
        model: "openai/gpt-5.2",
        status: "failure",
        requestId: "request_planner_test",
        error: "HTTP 429 too many requests"
      }];
      state.finalSummary = {
        task: state.goal,
        result: "failed",
        changedFiles: [],
        testsRun: [],
        evidence: ["Planner provider failed."],
        risksRemaining: ["Provider unavailable."],
        suggestedCommitMessage: "chore: retry"
      };

      const preview = await previewLearnedTaskMemory(cwd, state, { failureMemory: { enabled: true } });

      expect(preview.record?.providerOutcomes?.[0]).toMatchObject({
        role: "planner",
        provider: "openrouter",
        model: "openai/gpt-5.2",
        status: "failure",
        category: "rate_limited"
      });
      expect(JSON.stringify(preview.record)).not.toContain("sk-live");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("stores pre-validation negative signals from rejected candidate reviews even when final result completes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-review-negative-"));
    try {
      const state = await runOfflineGraph(cwd, "fix failing test with two candidate patches", defaultConfig);
      state.review = {
        mode: "standard",
        overallRecommendation: "Candidate B rejected; candidate A accepted.",
        reviews: [
          {
            candidateId: "candidate_a",
            correctnessScore: 8,
            riskScore: 2,
            invasiveness: "low",
            testCoverage: "adequate",
            securityConcerns: [],
            regressionConcerns: [],
            redTeamFindings: [],
            recommendation: "accept",
            notes: ["Narrow patch."]
          },
          {
            candidateId: "candidate_b",
            correctnessScore: 3,
            riskScore: 8,
            invasiveness: "high",
            testCoverage: "weak",
            securityConcerns: ["Touches unrelated auth code."],
            regressionConcerns: ["May break login flow."],
            redTeamFindings: [],
            recommendation: "reject",
            notes: ["Wrong file boundary."]
          }
        ]
      };
      state.events.push({
        id: "event_review_rejects_b",
        timestamp: "2026-06-07T00:00:00.000Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "review_decision",
        phase: "review",
        role: "reviewer",
        reviewRef: "reviews/review.json",
        recommendation: "Candidate B rejected."
      });
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
      const [record] = await readLearnedTaskMemory(cwd);

      expect(record.negativeSignals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: "pre_validation",
          source: "rejected_candidate",
          candidateId: "candidate_b",
          confidence: "strong",
          evidenceRefs: expect.arrayContaining(["reviews/review.json"])
        })
      ]));
      expect(record.failureClass).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("records post-validation reviewer misses, judge selection errors, and subtask failures", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-reviewer-miss-"));
    try {
      const state = await runOfflineGraph(cwd, "fix npm test failure in index.js", defaultConfig);
      state.plan = {
        ...state.plan!,
        steps: [
          ...state.plan!.steps,
          { id: "verify", title: "Run verification", detail: "Run npm test before completion.", status: "blocked" }
        ]
      };
      state.review = {
        mode: "standard",
        overallRecommendation: "Candidate A accepted.",
        reviews: [{
          candidateId: "fixture_candidate_a",
          correctnessScore: 8,
          riskScore: 2,
          invasiveness: "low",
          testCoverage: "adequate",
          securityConcerns: [],
          regressionConcerns: [],
          redTeamFindings: [],
          recommendation: "accept",
          notes: ["Looks correct before verifier."]
        }]
      };
      state.judge = {
        decision: "select",
        selectedCandidateId: "fixture_candidate_a",
        reason: "Selected reviewed candidate.",
        confidence: 0.8
      };
      state.runResults = [{
        command: "npm test",
        exitCode: 1,
        stdout: "",
        stderr: "AssertionError: still failing",
        durationMs: 10,
        success: false
      }];
      state.events.push({
        id: "event_review_accepts_a",
        timestamp: "2026-06-07T00:00:00.000Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "review_decision",
        phase: "review",
        role: "reviewer",
        reviewRef: "reviews/review.json",
        recommendation: "accept"
      }, {
        id: "event_judge_selects_a",
        timestamp: "2026-06-07T00:00:00.001Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "judge_decision",
        phase: "judge",
        role: "judge",
        decision: "select",
        selectedCandidateId: "fixture_candidate_a",
        reason: "Selected reviewed candidate.",
        confidence: 0.8,
        decisionRef: "judge/decision.json"
      }, {
        id: "event_shell_fails",
        timestamp: "2026-06-07T00:00:00.002Z",
        sessionId: state.sessionId,
        mode: "partial",
        type: "shell_run",
        phase: "shell",
        role: "runner",
        command: "npm test",
        cwd,
        success: false,
        exitCode: 1,
        stderrRef: "stderr/npm-test.txt"
      });
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

      expect(record.negativeSignals).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "post_validation", source: "reviewer_miss", candidateId: "fixture_candidate_a", confidence: "strong" }),
        expect.objectContaining({ stage: "post_validation", source: "judge_selection_error", candidateId: "fixture_candidate_a", confidence: "provisional" })
      ]));
      expect(record.subtaskSignals).toEqual(expect.arrayContaining([
        expect.objectContaining({ subtaskId: "verify", status: "failed", outcome: "failed", phase: "verification", evidenceRefs: ["stderr/npm-test.txt"] })
      ]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("normalizes terminal subtask outcomes so pending does not survive passed or failed records", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-subtask-normalize-"));
    try {
      const memoryDir = path.join(cwd, ".tomorrowedge");
      await mkdir(memoryDir, { recursive: true });
      const now = new Date().toISOString();
      await writeFile(path.join(memoryDir, "task-memory.jsonl"), `${JSON.stringify({
        schemaVersion: "task-memory/v2",
        createdAt: now,
        firstSeen: now,
        lastSeen: now,
        goalFingerprint: "subtask",
        goalPreview: "fix failing fixture bug",
        taskType: "bugfix",
        riskLevel: "low",
        routingMode: "balanced",
        accessMode: "partial",
        constraints: [],
        verificationCommands: ["npm test"],
        result: "completed",
        subtaskSignals: [
          { subtaskId: "verify", status: "pending", outcome: "passed", phase: "verification" },
          { subtaskId: "review", status: "pending", outcome: "review_blocked", phase: "review" }
        ]
      })}\n`, "utf8");

      const [record] = await readLearnedTaskMemory(cwd);

      expect(record.subtaskSignals).toEqual([
        expect.objectContaining({ subtaskId: "verify", status: "done", outcome: "passed" }),
        expect.objectContaining({ subtaskId: "review", status: "done_with_blocking_signal", outcome: "review_blocked" })
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("uses task-scoped strategy memory and avoids recently failed provider routes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-strategy-provider-avoid-"));
    try {
      const memoryDir = path.join(cwd, ".tomorrowedge");
      await mkdir(memoryDir, { recursive: true });
      const now = new Date().toISOString();
      const rows = [
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "failed-provider",
          goalPreview: "fix npm test failure",
          taskType: "test",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm test"],
          result: "failed",
          providerOutcomes: [{
            role: "coder_a",
            provider: "openrouter",
            model: "openai/gpt-5.2",
            status: "failure",
            category: "rate_limited",
            reason: "HTTP 429 rate limit exceeded"
          }]
        },
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "old-success-openrouter",
          goalPreview: "fix npm test failure",
          taskType: "test",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm test"],
          result: "completed",
          routeAssignments: [{ role: "coder_a", provider: "openrouter", model: "openai/gpt-5.2" }]
        },
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "success-deepseek",
          goalPreview: "fix npm test failure",
          taskType: "test",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm test"],
          result: "completed",
          routeAssignments: [{ role: "coder_a", provider: "deepseek", model: "deepseek-chat" }]
        }
      ];
      await writeFile(path.join(memoryDir, "task-memory.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

      const hints = await buildStrategyMemoryHints(cwd, {
        task: "fix failing npm test",
        enabledProviders: ["openrouter", "deepseek"]
      });

      expect(hints.taskType).toBe("bugfix");
      expect(hints.secondarySignals).toEqual(["test_failure"]);
      expect(hints.matchedRecords).toBe(3);
      expect(hints.avoidedRoutes).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "coder_a", provider: "openrouter", model: "openai/gpt-5.2", category: "rate_limited" })
      ]));
      expect(hints.routeAssignments).toEqual([
        expect.objectContaining({ role: "coder_a", provider: "deepseek", model: "deepseek-chat" })
      ]);
      expect(hints.routeAssignments[0]?.reason).toContain("completed bugfix workflow");
      expect(hints.routeAssignments[0]?.reason).not.toContain("completed test workflow matched to bugfix");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not let unrelated task memory drive a task-scoped strategy preview", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-strategy-scope-"));
    try {
      const memoryDir = path.join(cwd, ".tomorrowedge");
      await mkdir(memoryDir, { recursive: true });
      const now = new Date().toISOString();
      const rows = [
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "docs-task",
          goalPreview: "update README docs",
          taskType: "docs",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm run docs:status"],
          result: "completed",
          routeAssignments: [{ role: "coder_a", provider: "openrouter", model: "openai/gpt-5.2" }]
        },
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "test-task",
          goalPreview: "fix npm test failing assertion",
          taskType: "test",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm test"],
          result: "completed",
          routeAssignments: [{ role: "coder_a", provider: "deepseek", model: "deepseek-chat" }]
        }
      ];
      await writeFile(path.join(memoryDir, "task-memory.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

      const hints = await buildStrategyMemoryHints(cwd, { task: "fix failing test" });

      expect(hints.taskType).toBe("bugfix");
      expect(hints.secondarySignals).toEqual(["test_failure"]);
      expect(hints.matchedRecords).toBe(1);
      expect(hints.preferredTestCommand).toBe("npm test");
      expect(hints.routeAssignments).toEqual([
        expect.objectContaining({ provider: "deepseek", model: "deepseek-chat" })
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("classifies strategy memory bugfixes with test-failure as a secondary signal", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-strategy-type-"));
    try {
      const memoryDir = path.join(cwd, ".tomorrowedge");
      await mkdir(memoryDir, { recursive: true });
      const now = new Date().toISOString();
      await writeFile(path.join(memoryDir, "task-memory.jsonl"), `${[
        { schemaVersion: "task-memory/v2", createdAt: now, firstSeen: now, lastSeen: now, goalFingerprint: "bug", goalPreview: "fix failing fixture bug", taskType: "bugfix", riskLevel: "low", routingMode: "balanced", accessMode: "partial", constraints: [], verificationCommands: ["npm test"], result: "completed", routeAssignments: [{ role: "coder_a", provider: "deepseek", model: "deepseek-chat" }] },
        { schemaVersion: "task-memory/v2", createdAt: now, firstSeen: now, lastSeen: now, goalFingerprint: "tests", goalPreview: "add tests for parser", taskType: "test", riskLevel: "low", routingMode: "balanced", accessMode: "partial", constraints: [], verificationCommands: ["npm test"], result: "completed", routeAssignments: [{ role: "coder_a", provider: "openrouter", model: "qwen/free" }] }
      ].map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

      const bugfix = await buildStrategyMemoryHints(cwd, { task: "fix failing fixture bug" });
      const tests = await buildStrategyMemoryHints(cwd, { task: "add tests for parser" });
      const repair = await buildStrategyMemoryHints(cwd, { task: "repair failing unit test caused by implementation bug" });

      expect(bugfix).toMatchObject({ taskType: "bugfix", secondarySignals: ["test_failure"] });
      expect(bugfix.routeAssignments).toEqual([expect.objectContaining({ provider: "deepseek" })]);
      expect(tests).toMatchObject({ taskType: "test" });
      expect(repair.taskType).toBe("bugfix");
      expect(repair.secondarySignals).toEqual(["test_failure"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prints disabled strategy memory as preview-only recommendations", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-strategy-preview-"));
    try {
      const memoryDir = path.join(cwd, ".tomorrowedge");
      await mkdir(memoryDir, { recursive: true });
      const now = new Date().toISOString();
      await writeFile(path.join(memoryDir, "task-memory.jsonl"), `${JSON.stringify({
        schemaVersion: "task-memory/v2",
        createdAt: now,
        firstSeen: now,
        lastSeen: now,
        goalFingerprint: "route",
        goalPreview: "fix failing fixture bug",
        taskType: "bugfix",
        riskLevel: "low",
        routingMode: "balanced",
        accessMode: "partial",
        constraints: [],
        verificationCommands: ["npm test"],
        result: "completed",
        routeAssignments: [{ role: "coder_a", provider: "mock", model: "mock-balanced" }]
      })}\n`, "utf8");
      await saveProjectPreferences(cwd, { strategyMemoryRouting: false });

      const text = await captureStdout(() => memoryCommand(cwd, { strategy: "fix failing fixture bug" }));
      const json = JSON.parse(await captureStdout(() => memoryCommand(cwd, { strategy: "fix failing fixture bug", json: true })));

      expect(text).toContain("strategy memory is disabled; showing preview recommendations only.");
      expect(text).toContain("recommend\tcoder_a");
      expect(json).toMatchObject({ enabled: false, previewOnly: true, applied: false, routeAssignments: [] });
      expect(json.routeRecommendations).toEqual([expect.objectContaining({ role: "coder_a", provider: "mock" })]);
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
      state.changedFiles = ["index.js"];
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
      expect(record.wrongAssumption).toContain("npm test");
      expect(record.correctedRule).toContain("npm test");
      expect(record.applicability).toContain("failure_class:validation_failed");
      expect(record.counterexamples?.some((item) => item.includes("npm test"))).toBe(true);
      expect(record.validationCommand).toBe("npm test");
      expect(record.correctionStatus).toBe("partial");
      expect(["coder_a", "coder_b", "repairer"]).toContain(record.introducedByPhase);
      expect(record.detectedByPhase).toBe("runner");
      expect(record.attributionConfidence).toBeGreaterThan(0.5);
      expect(record.filePatterns).toContain("file:index.js");
      expect(record.frameworkSignals).toContain("node");
      expect(record.patchApproach).toBeDefined();
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

  it("retrieves structurally similar failure memories and rejects unrelated near misses", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-structured-search-"));
    try {
      const memoryDir = path.join(cwd, ".tomorrowedge");
      await mkdir(memoryDir, { recursive: true });
      const now = new Date().toISOString();
      const rows = [
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "pytest-api",
          goalPreview: "repair API route pytest validation failure",
          taskType: "test",
          riskLevel: "medium",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: ["API route must preserve response schema"],
          verificationCommands: ["pytest tests/api"],
          result: "failed",
          failureClass: "validation_failed",
          failureSignature: "pytest-api-signature",
          correction: "Reproduce pytest tests/api and fix the API route regression.",
          correctedRule: "Use pytest tests/api before marking the route fixed.",
          validationCommand: "pytest tests/api",
          correctionStatus: "verified",
          filePatterns: ["dir:api", "ext:.py"],
          frameworkSignals: ["python"],
          patchApproach: "minimal_patch",
          introducedByPhase: "coder_a",
          detectedByPhase: "runner",
          evidenceRefs: [],
          confidence: 0.9,
          recurrenceCount: 2,
          fixedCount: 1,
          sourceSessionIds: ["session_pytest_api"]
        },
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "readme-docs",
          goalPreview: "update README docs",
          taskType: "docs",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm run docs:status"],
          result: "failed",
          failureClass: "workflow_incomplete",
          failureSignature: "docs-signature",
          correction: "Run docs status after editing README.",
          correctedRule: "Docs updates need docs status.",
          correctionStatus: "verified",
          filePatterns: ["file:README.md", "ext:.md"],
          frameworkSignals: ["node"],
          evidenceRefs: [],
          confidence: 0.9,
          recurrenceCount: 1,
          fixedCount: 1,
          sourceSessionIds: ["session_docs"]
        }
      ];
      await writeFile(path.join(memoryDir, "task-memory.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

      const explanation = await explainFailureMemories(cwd, "fix python API pytest failure in api/users.py");

      expect(explanation.selected[0]?.goalFingerprint).toBe("pytest-api");
      expect(explanation.selected[0]?.matchedSignals).toEqual(expect.arrayContaining(["pytest", "api"]));
      expect(explanation.rejected.some((item) => item.id.includes("readme-docs") || item.reason === "low task-signal overlap")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("ranks verified corrections above unverified lessons with the same task signals", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-task-failure-verified-rank-"));
    try {
      const memoryDir = path.join(cwd, ".tomorrowedge");
      await mkdir(memoryDir, { recursive: true });
      const now = new Date().toISOString();
      const rows = [
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "unverified",
          goalPreview: "fix npm test validation failure",
          taskType: "test",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm test"],
          result: "failed",
          failureClass: "validation_failed",
          failureSignature: "unverified-signature",
          correction: "Try a verifier-focused repair.",
          correctedRule: "Rerun npm test before claiming the patch is fixed.",
          correctionStatus: "unverified",
          evidenceRefs: [],
          confidence: 0.9,
          recurrenceCount: 1,
          fixedCount: 0,
          sourceSessionIds: ["session_unverified"]
        },
        {
          schemaVersion: "task-memory/v2",
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
          goalFingerprint: "verified",
          goalPreview: "fix npm test validation failure",
          taskType: "test",
          riskLevel: "low",
          routingMode: "balanced",
          accessMode: "partial",
          constraints: [],
          verificationCommands: ["npm test"],
          result: "failed",
          failureClass: "validation_failed",
          failureSignature: "verified-signature",
          correction: "Apply a verifier-backed repair.",
          correctedRule: "Rerun npm test before claiming the patch is fixed.",
          correctionStatus: "verified",
          evidenceRefs: [],
          confidence: 0.9,
          recurrenceCount: 1,
          fixedCount: 1,
          sourceSessionIds: ["session_verified"]
        }
      ];
      await writeFile(path.join(memoryDir, "task-memory.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

      const explanation = await explainFailureMemories(cwd, "fix npm test validation failure");

      expect(explanation.selected[0]?.correctionStatus).toBe("verified");
      expect(explanation.selected[0]?.score).toBeGreaterThan(explanation.selected[1]?.score ?? 0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

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
