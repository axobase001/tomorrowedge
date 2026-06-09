import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { generateNativeObjectiveContract } from "../../src/core/contracts/contractGenerator.js";
import { verifyAndRepairContract } from "../../src/core/contracts/contractVerifier.js";
import { evolvePoliciesOffline } from "../../src/core/orchestrationPolicy/policyEvolution.js";
import { loadBestPolicy, savePolicyScore } from "../../src/core/orchestrationPolicy/policyStore.js";
import { defaultOrchestrationPolicy } from "../../src/core/orchestrationPolicy/orchestrationPolicy.js";
import { classifyWorkflowIntentLocally, type WorkflowIntentDecision } from "../../src/core/goal/workflowIntent.js";
import { profileScenario } from "../../src/core/scenarios/scenarioProfiler.js";
import { addTrace, retrieveSimilar } from "../../src/core/traces/traceStore.js";
import type { ObjectiveTraceV1 } from "../../src/core/traces/objectiveTrace.js";

describe("objective trace memory and policy evolution", () => {
  it("retrieves scenario-similar objective traces", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-objective-trace-"));
    try {
      const trace = makeTrace("fix failing test", "success");
      await addTrace(cwd, trace);

      const similar = await retrieveSimilar(cwd, "fix failing test in math helper", trace.scenarioProfile, 3);

      expect(similar.map((item) => item.traceId)).toEqual(["trace_test"]);
      expect(similar[0]?.outcome.lessons).toContain("Run verifier after patch.");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("evolves and persists policy variants from objective traces", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-policy-evolve-"));
    try {
      const trace = makeTrace("fix failing test", "partial");
      const result = evolvePoliciesOffline({
        basePolicy: defaultOrchestrationPolicy("2026-06-09T00:00:00.000Z"),
        traces: [trace],
        maxPolicyVariants: 4,
        eliteRetention: 2
      });

      expect(result.variants).toHaveLength(4);
      expect(result.selected).toHaveLength(2);
      expect(result.selected[0]?.metadata.fitness).toBeTypeOf("number");

      await savePolicyScore(cwd, result.selected[0]!);
      const best = await loadBestPolicy(cwd);

      expect(best.policyId).toBe(result.selected[0]?.policyId);
      expect(best.metadata.source).toBe("selected");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function makeTrace(goal: string, status: ObjectiveTraceV1["outcome"]["finalStatus"]): ObjectiveTraceV1 {
  const workflowIntent = withProvider(classifyWorkflowIntentLocally(goal));
  const scenarioProfile = profileScenario({ goal, workflowIntent, accessMode: "partial" });
  const contract = generateNativeObjectiveContract({
    goal,
    workflowIntent,
    scenarioProfile,
    retrievedTraces: [],
    config: defaultConfig,
    accessMode: "partial"
  });
  const { verification } = verifyAndRepairContract(contract, { accessMode: "partial", workflowIntent, scenarioProfile, config: defaultConfig, baseline: contract });
  return {
    schemaVersion: "objective-trace/v1",
    traceId: "trace_test",
    runId: "session_test",
    createdAt: "2026-06-09T00:00:00.000Z",
    goal,
    scenarioProfile,
    contract,
    contractVerification: verification,
    planSummary: {
      workflowKind: contract.workflowKind,
      steps: ["Verify objective contract", "Produce patch candidate"],
      allowedPhases: contract.allowedPhases,
      verificationCommands: contract.verificationRubric.requiredCommands
    },
    roleGraphSummary: {
      rolesUsed: ["planner", "coder_a", "reviewer", "judge"],
      routingDecisions: ["planner->native: contract-first"],
      fallbackDecisions: []
    },
    executionSummary: {
      actions: ["patch_candidate:fixture_candidate_a"],
      toolCalls: ["file_read:index.js"],
      observations: ["review accepted"],
      shellRuns: status === "success" ? 1 : 0,
      filesTouched: status === "success" ? ["index.js"] : []
    },
    evidenceSummary: {
      evidencePacketRefs: ["artifacts/evidence_packets/test.json"],
      requiredEvidenceSatisfied: ["objective contract", "event ledger", "review decision", "judge decision"],
      missingEvidence: status === "success" ? [] : ["verification result"],
      evidenceScore: status === "success" ? 100 : 70
    },
    verificationSummary: {
      status: status === "success" ? "success" : "partial",
      passedCriteria: status === "success" ? contract.successCriteria : [],
      failedCriteria: status === "success" ? [] : contract.failureCriteria,
      reviewerDecision: "accept",
      judgeDecision: "select"
    },
    repairSummary: {
      repairAttempts: 0,
      recovered: false
    },
    costSummary: {
      tokens: 0,
      toolCalls: 1,
      shellRuns: status === "success" ? 1 : 0
    },
    feedback: {
      implicitSignals: []
    },
    outcome: {
      finalStatus: status,
      lessons: ["Run verifier after patch."]
    }
  };
}

function withProvider(decision: Omit<WorkflowIntentDecision, "provider" | "model" | "fallbackUsed">): WorkflowIntentDecision {
  return { ...decision, provider: "test", model: "local" };
}
