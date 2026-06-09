import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { buildCockpitViewModel } from "../../src/cockpit/viewModel.js";
import { buildAccessPolicy } from "../../src/core/permissions/accessPolicy.js";
import type { AgentGraphState } from "../../src/core/agentGraph/state.js";
import type { TomorrowEdgeEvent } from "../../src/core/events/eventTypes.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";

describe("cockpit view model", () => {
  it("projects an offline run into four-zone cockpit sections", async () => {
    const state = await runOfflineGraph(process.cwd(), "fix failing test", defaultConfig, { fixtureMode: true });
    const vm = buildCockpitViewModel(process.cwd(), state);

    expect(vm.version).toBe("1");
    expect(vm.workflow.map((step) => step.label)).toEqual(["Plan", "Route", "Edit", "Review", "Test", "Judge", "Approve"]);
    expect(vm.tasks[0]?.selected).toBe(true);
    expect(vm.telemetry.dispatched).toBeGreaterThan(0);
    expect(vm.telemetry.providerSummary).toBeTruthy();
    expect(vm.trace.length).toBeGreaterThan(0);
    expect(vm.sessionMeta.source).toBe("saved");
    expect(vm.sessionMeta.stale).toBe(true);
    expect(vm.roleGraph?.workflowKind).toBe("debate_patch");
    expect(vm.capabilities.find((item) => item.id === "provider-routing")?.status).toBe("available");
    expect(vm.capabilities.find((item) => item.id === "workflow-ledger")?.readiness).toContain("event");
  });

  it("marks live snapshots as connected and non-stale", async () => {
    const state = await runOfflineGraph(process.cwd(), "fix failing test", defaultConfig, { fixtureMode: true });
    const vm = buildCockpitViewModel(process.cwd(), state, { source: "live", connectionState: "connected", stale: false });

    expect(vm.sessionMeta.source).toBe("live");
    expect(vm.sessionMeta.connectionState).toBe("connected");
    expect(vm.sessionMeta.stale).toBe(false);
  });

  it("marks explicit fixture sessions separately from production sessions", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState());

    expect(vm.sessionMeta.source).toBe("saved");
    expect(vm.sessionMeta.fixtureMode).toBe(true);
  });

  it("projects retrieved failure-memory influence into cockpit cards", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      failureMemory: {
        premortem: {
          schemaVersion: "failure-memory-premortem/v1",
          task: "fix failing test",
          selectedMemoryIds: ["mem_validation"],
          rejected: [{ id: "mem_old", reason: "stale" }],
          knownTraps: ["mem_validation: validation_failed"],
          avoidRules: ["Preserve npm test"],
          extraChecks: ["npm test"],
          constraints: [{
            id: "constraint_test",
            kind: "test_command",
            memoryId: "mem_validation",
            failureClass: "validation_failed",
            text: "Run npm test before approving.",
            command: "npm test",
            confidence: 0.9,
            score: 8,
            evidenceRefs: ["artifacts/stderr.txt"]
          }]
        },
        coderConstraints: [{
          id: "constraint_test",
          kind: "test_command",
          memoryId: "mem_validation",
          failureClass: "validation_failed",
          text: "Run npm test before approving.",
          command: "npm test",
          confidence: 0.9,
          score: 8,
          evidenceRefs: ["artifacts/stderr.txt"]
        }],
        reviewAssessments: [{
          candidateId: "candidate_a",
          memoryIds: ["mem_validation"],
          memoryViolations: [],
          memoryAlignment: ["keeps memory-required verifier: npm test"],
          penalty: 0
        }]
      },
      events: [{
        id: "event_memory",
        timestamp: "2026-06-07T00:00:00.000Z",
        sessionId: "session_invariant",
        mode: "partial",
        type: "memory_retrieval",
        phase: "planning",
        role: "planner",
        retrievalStage: "premortem",
        selectedMemoryIds: ["mem_validation"],
        rejectedCount: 1,
        constraintCount: 1,
        artifactRef: "artifacts/memory/memory_1.json",
        summary: "pre-mortem selected 1 memory"
      }]
    }));

    expect(vm.memoryInfluence?.selectedCount).toBe(1);
    expect(vm.memoryInfluence?.rejectedCount).toBe(1);
    expect(vm.memoryInfluence?.cards[0]?.score).toBe(8);
    expect(vm.memoryInfluence?.cards.some((card) => card.stage === "review_guard" && card.alignment.length)).toBe(true);
  });

  it("projects verification failure, repair, and memory retrieval into an error-loop timeline", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      events: [
        eventBase("event_candidate", "patch_candidate", {
          phase: "coding",
          role: "coder_a",
          candidateId: "candidate_a",
          approach: "minimal_patch",
          summary: "Initial patch candidate.",
          filesChanged: ["index.js"],
          diffRef: "artifacts/diffs/candidate_a.patch",
          estimatedRisk: "low"
        }),
        eventBase("event_apply", "patch_apply", {
          phase: "patch",
          role: "runner",
          provider: "local_tool",
          model: "patch",
          candidateId: "candidate_a",
          filesChanged: ["index.js"],
          diffRef: "artifacts/diffs/candidate_a.patch",
          undoSnapshotIds: ["undo_1"],
          applied: true
        }),
        eventBase("event_shell_failed", "shell_run", {
          phase: "shell",
          role: "runner",
          provider: "local_tool",
          model: "shell",
          command: "npm test",
          cwd: process.cwd(),
          exitCode: 1,
          stdoutRef: "artifacts/stdout/failed.txt",
          stderrRef: "artifacts/stderr/failed.txt",
          durationMs: 22,
          success: false
        }),
        eventBase("event_repair_memory", "memory_retrieval", {
          phase: "repair",
          role: "repairer",
          retrievalStage: "repair_context",
          selectedMemoryIds: ["mem_validation"],
          rejectedCount: 0,
          constraintCount: 1,
          artifactRef: "artifacts/memory/repair_context.json",
          summary: "repair context selected 1 memory"
        }),
        eventBase("event_repair", "repair_attempt", {
          phase: "repair",
          role: "repairer",
          candidateId: "repair_candidate_a",
          filesChanged: ["index.js"],
          diffRef: "artifacts/diffs/repair.patch"
        }),
        eventBase("event_shell_passed", "shell_run", {
          phase: "shell",
          role: "runner",
          provider: "local_tool",
          model: "shell",
          command: "npm test",
          cwd: process.cwd(),
          exitCode: 0,
          stdoutRef: "artifacts/stdout/passed.txt",
          stderrRef: "artifacts/stderr/passed.txt",
          durationMs: 18,
          success: true
        }),
        eventBase("event_stop", "workflow_stop_reason", {
          phase: "summary",
          reason: "repair applied and verification passed",
          result: "completed"
        })
      ]
    }));

    expect(vm.errorLoopTimeline?.failedVerifications).toBe(1);
    expect(vm.errorLoopTimeline?.passedVerifications).toBe(1);
    expect(vm.errorLoopTimeline?.repairAttempts).toBe(1);
    expect(vm.errorLoopTimeline?.memoryRetrievals).toBe(1);
    expect(vm.errorLoopTimeline?.stopReason).toBe("repair applied and verification passed");
    expect(vm.errorLoopTimeline?.items.map((item) => item.kind)).toEqual(["candidate", "patch_apply", "verification", "memory", "repair", "verification", "stop"]);
    expect(vm.errorLoopTimeline?.items.find((item) => item.kind === "memory")?.memoryIds).toEqual(["mem_validation"]);
  });

  it("switches the main view to approval when a candidate waits for authorization", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-vm-approval-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const vm = buildCockpitViewModel(cwd, state);

      expect(vm.status).toBe("waiting_approval");
      expect(vm.currentApproval?.kind).toBe("patch");
      expect(vm.main.title).toContain("approval");
      expect(vm.main.diff).toContain("return a + b");
      expect(vm.approvalHistory.at(-1)?.approvalId).toBe(vm.currentApproval?.id);
      expect(vm.approvalHistory.at(-1)?.blocksProgress).toBe(true);
      expect(vm.approvalHistory.at(-1)?.filterTags).toEqual(["patch", "pending"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps partially completed sessions in waiting approval when an approval remains", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-vm-partial-"));
    await cp(path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic"), cwd, { recursive: true });
    try {
      const state = await runOfflineGraph(cwd, "fix failing test", defaultConfig, { fixtureMode: true });
      const persistedPartial = {
        ...state,
        agents: state.agents.filter((agent) => agent.status !== "waiting_for_user")
      };
      const vm = buildCockpitViewModel(cwd, persistedPartial);

      expect(vm.currentApproval?.status).toBe("waiting");
      expect(vm.status).toBe("waiting_approval");
      expect(vm.statusText).toBe("Waiting approval");
      expect(vm.tasks[0]?.status).toBe("waiting");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("pins pending approval above a contradictory completed final summary", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      agents: [{
        id: "approval_patch",
        role: "runner",
        provider: "local_tool",
        model: "approval_gate",
        status: "waiting_for_user",
        summary: "Patch approval required."
      }],
      finalSummary: {
        task: "fix failing test",
        result: "completed",
        changedFiles: [],
        testsRun: [],
        evidence: ["contradictory summary"],
        risksRemaining: [],
        suggestedCommitMessage: "fix: update index"
      }
    }));

    expect(vm.currentApproval?.status).toBe("waiting");
    expect(vm.status).toBe("waiting_approval");
    expect(vm.statusText).toBe("Waiting approval");
    expect(vm.tasks[0]?.status).toBe("waiting");
    expect(vm.main.title).toBe("Waiting for patch approval");
  });

  it("does not show passed tests before the patch has been applied", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      runResults: [{
        command: "npm test",
        exitCode: 0,
        stdout: "passed",
        stderr: "",
        durationMs: 12,
        success: true
      }]
    }));

    expect(vm.currentApproval?.kind).toBe("patch");
    expect(vm.currentApproval?.testStatus).toBe("not_run");
    expect(vm.main.testStatus).toBe("not_run");
    expect(vm.workflow.find((step) => step.id === "test")?.status).toBe("pending");
  });

  it("does not create patch approvals for empty no-op candidates", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      candidates: [{
        candidateId: "candidate_empty",
        agentId: "coder_a",
        approach: "analysis_only",
        summary: "No file writes needed.",
        filesChanged: [],
        unifiedDiff: "",
        testPlan: [],
        knownTradeoffs: [],
        estimatedRisk: "low"
      }],
      judge: {
        selectedCandidateId: "candidate_empty",
        decision: "select",
        reason: "No-op result is enough.",
        confidence: 0.9
      },
      finalSummary: {
        task: "inspect repository",
        result: "completed",
        changedFiles: [],
        testsRun: [],
        evidence: ["Read-only request completed."],
        risksRemaining: [],
        suggestedCommitMessage: "docs: inspect repository"
      }
    }));

    expect(vm.currentApproval).toBeUndefined();
    expect(vm.status).toBe("done");
    expect(vm.approvalHistory.some((item) => item.kind === "patch" && item.status === "waiting")).toBe(false);
  });

  it("does not mark pending patch authorization as rejected history", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      events: [{
        id: "event_patch_pending",
        timestamp: "2026-06-07T00:00:00.000Z",
        sessionId: "session_invariant",
        mode: "partial",
        type: "patch_apply",
        phase: "patch",
        role: "runner",
        provider: "local_tool",
        model: "patch",
        candidateId: "candidate_a",
        filesChanged: ["index.js"],
        undoSnapshotIds: [],
        applied: false,
        error: "Patch application blocked: approval required."
      }]
    }));

    expect(vm.approvalHistory.some((item) => item.action === "rejected")).toBe(false);
    expect(vm.approvalHistory.at(-1)?.action).toBe("waiting");
  });

  it("shows shell approval only after patch application and before shell execution", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      changedFiles: ["index.js"],
      approvals: { patchApproved: true, shellApproved: false, repairApproved: false }
    }));

    expect(vm.currentApproval?.kind).toBe("shell");
    expect(vm.status).toBe("waiting_approval");
    expect(vm.workflow.find((step) => step.id === "test")?.status).toBe("pending");
    expect(vm.main.filesChanged).toEqual(["index.js"]);
    expect(vm.approvalHistory.at(-1)?.approvalId).toBe("shell:test");
    expect(vm.approvalHistory.at(-1)?.command).toBe("npm test");
    expect(vm.approvalHistory.at(-1)?.filterTags).toEqual(["shell", "pending"]);
  });

  it("surfaces pending repair approval after failed verification", () => {
    const repairDiff = "--- a/index.js\n+++ b/index.js\n@@\n-return a + b\n+return Number(a) + Number(b)\n";
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      changedFiles: ["index.js"],
      approvals: { patchApproved: true, shellApproved: true, repairApproved: false },
      agents: [{
        id: "approval_repair",
        role: "runner",
        provider: "local_tool",
        model: "approval_gate",
        status: "waiting_for_user",
        summary: "Repair approval required."
      }],
      runResults: [{
        command: "npm test",
        exitCode: 1,
        stdout: "",
        stderr: "expected numeric add",
        durationMs: 20,
        success: false
      }],
      repairCandidates: [{
        candidateId: "repair_candidate_a",
        agentId: "repairer",
        approach: "repair",
        summary: "Repair numeric coercion after failed verification.",
        filesChanged: ["index.js"],
        unifiedDiff: repairDiff,
        testPlan: ["npm test"],
        knownTradeoffs: [],
        estimatedRisk: "low"
      }]
    }));

    expect(vm.status).toBe("waiting_approval");
    expect(vm.currentApproval?.kind).toBe("repair");
    expect(vm.currentApproval?.candidateId).toBe("repair_candidate_a");
    expect(vm.main.title).toBe("Waiting for repair approval");
    expect(vm.main.diff).toBe(repairDiff);
    expect(vm.approvalHistory.at(-1)?.approvalId).toBe("patch:repair_candidate_a");
    expect(vm.approvalHistory.at(-1)?.filterTags).toEqual(["patch", "pending"]);
  });

  it("keeps a completed workflow done when no approval is pending", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      changedFiles: ["index.js"],
      runResults: [{
        command: "npm test",
        exitCode: 0,
        stdout: "passed",
        stderr: "",
        durationMs: 12,
        success: true
      }],
      approvals: { patchApproved: true, shellApproved: true, repairApproved: false },
      finalSummary: {
        task: "fix failing test",
        result: "completed",
        changedFiles: ["index.js"],
        testsRun: ["npm test"],
        evidence: ["Command passed: npm test"],
        risksRemaining: [],
        suggestedCommitMessage: "fix: update index"
      }
    }));

    expect(vm.currentApproval).toBeUndefined();
    expect(vm.status).toBe("done");
    expect(vm.workflow.find((step) => step.id === "test")?.status).toBe("done");
    expect(vm.main.testStatus).toBe("passed");
  });
});

function eventBase<T extends TomorrowEdgeEvent["type"]>(id: string, type: T, fields: Omit<Extract<TomorrowEdgeEvent, { type: T }>, "id" | "timestamp" | "sessionId" | "mode" | "type">): Extract<TomorrowEdgeEvent, { type: T }> {
  return {
    id,
    timestamp: "2026-06-07T00:00:00.000Z",
    sessionId: "session_invariant",
    mode: "partial",
    type,
    ...fields
  } as Extract<TomorrowEdgeEvent, { type: T }>;
}

function sampleCockpitState(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: "session_invariant",
    goal: "fix failing test",
    routing: {
      mode: "balanced",
      privacyLocked: false,
      assignments: [{ role: "coder_a", provider: "fixture", model: "fixture-scripted", reason: "test" }],
      fallbacks: []
    },
    access: buildAccessPolicy(defaultConfig, { mode: "partial" }),
    events: [],
    eventArtifacts: [],
    providerViews: [],
    evidencePackets: [],
    agents: [],
    plan: {
      goal: "fix failing test",
      constraints: [],
      riskLevel: "low",
      taskType: "bugfix",
      steps: [{ id: "plan", title: "Fix add()", detail: "Patch index.js", status: "done" }],
      expectedFiles: ["index.js"],
      verificationCommands: ["npm test"],
      debateRecommended: false
    },
    candidates: [{
      candidateId: "candidate_a",
      agentId: "coder_a",
      approach: "minimal_patch",
      summary: "Fix add implementation.",
      filesChanged: ["index.js"],
      unifiedDiff: "--- a/index.js\n+++ b/index.js\n@@\n-return a - b\n+return a + b\n",
      testPlan: ["npm test"],
      knownTradeoffs: [],
      estimatedRisk: "low"
    }],
    repairCandidates: [],
    debateRounds: [],
    modelNotes: [],
    usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    budgetStatuses: [],
    review: {
      mode: "standard",
      reviews: [{
        candidateId: "candidate_a",
        correctnessScore: 0.9,
        riskScore: 0.1,
        invasiveness: "low",
        testCoverage: "adequate",
        securityConcerns: [],
        regressionConcerns: [],
        redTeamFindings: [],
        recommendation: "accept",
        notes: []
      }],
      overallRecommendation: "accept"
    },
    judge: {
      selectedCandidateId: "candidate_a",
      decision: "select",
      reason: "Candidate fixes the failing add test.",
      confidence: 0.92
    },
    changedFiles: [],
    runResults: [],
    approvals: { patchApproved: false, shellApproved: false, repairApproved: false },
    ...overrides
  };
}
