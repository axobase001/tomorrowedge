import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { buildCockpitViewModel } from "../../src/cockpit/viewModel.js";
import { buildAccessPolicy } from "../../src/core/permissions/accessPolicy.js";
import type { AgentGraphState } from "../../src/core/agentGraph/state.js";
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

  it("shows shell approval only after patch application and before shell execution", () => {
    const vm = buildCockpitViewModel(process.cwd(), sampleCockpitState({
      changedFiles: ["index.js"],
      approvals: { patchApproved: true, shellApproved: false, repairApproved: false }
    }));

    expect(vm.currentApproval?.kind).toBe("shell");
    expect(vm.status).toBe("waiting_approval");
    expect(vm.workflow.find((step) => step.id === "test")?.status).toBe("pending");
    expect(vm.main.filesChanged).toEqual(["index.js"]);
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
