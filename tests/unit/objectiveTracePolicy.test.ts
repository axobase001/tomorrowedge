import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { generateNativeObjectiveContract } from "../../src/core/contracts/contractGenerator.js";
import { verifyAndRepairContract } from "../../src/core/contracts/contractVerifier.js";
import { evolvePoliciesOffline } from "../../src/core/orchestrationPolicy/policyEvolution.js";
import { evaluatePolicyFitness } from "../../src/core/orchestrationPolicy/policyEvaluator.js";
import { ORCHESTRATION_POLICY_MUTATION_OPERATOR_COUNT, mutatePolicy } from "../../src/core/orchestrationPolicy/policyMutation.js";
import { loadBestPolicy, savePolicyScore } from "../../src/core/orchestrationPolicy/policyStore.js";
import { defaultOrchestrationPolicy } from "../../src/core/orchestrationPolicy/orchestrationPolicy.js";
import type { WorkflowIntentDecision } from "../../src/core/goal/workflowIntent.js";
import type { ScenarioProfile } from "../../src/core/scenarios/scenarioTypes.js";
import { addTrace, readTraces, retrieveSimilar, retrieveSimilarWithDiagnostics } from "../../src/core/traces/traceStore.js";
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

  it("serializes concurrent objective trace appends", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-objective-trace-concurrent-"));
    try {
      const traces = Array.from({ length: 20 }, (_, index) => makeTrace(`fix failing test ${index}`, "success", { traceId: `trace_${index}` }));

      await Promise.all(traces.map((trace) => addTrace(cwd, trace)));
      const persisted = await readTraces(cwd, { limit: 50, newestFirst: false });

      expect(persisted.map((trace) => trace.traceId).sort()).toEqual(traces.map((trace) => trace.traceId).sort());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("warns when malformed objective trace lines are skipped", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-objective-trace-malformed-"));
    const stderr: string[] = [];
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      return true;
    }) as typeof process.stderr.write);
    try {
      await mkdir(path.join(cwd, ".tomorrowedge"), { recursive: true });
      const trace = makeTrace("fix failing test", "success", { traceId: "valid_trace" });
      await writeFile(path.join(cwd, ".tomorrowedge", "objective-traces.jsonl"), `{not-json}\n${JSON.stringify(trace)}\n`, "utf8");

      const traces = await readTraces(cwd, { limit: 10, newestFirst: false });

      expect(traces.map((item) => item.traceId)).toEqual(["valid_trace"]);
      expect(stderr.join("")).toContain("Ignoring malformed objective trace line 1");
    } finally {
      writeSpy.mockRestore();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("weights retrieved traces with tracePolicy success, failure, recency, and stale preferences", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-trace-policy-weight-"));
    try {
      const recentSuccess = makeTrace("fix failing test", "success", {
        traceId: "recent_success",
        createdAt: new Date().toISOString()
      });
      const recentFailure = makeTrace("fix failing test", "failure", {
        traceId: "recent_failure",
        createdAt: new Date().toISOString()
      });
      const staleSuccess = makeTrace("fix failing test", "success", {
        traceId: "stale_success",
        createdAt: "2020-01-01T00:00:00.000Z"
      });
      await addTrace(cwd, staleSuccess);
      await addTrace(cwd, recentSuccess);
      await addTrace(cwd, recentFailure);

      const failureFirst = await retrieveSimilar(cwd, "fix failing test", recentSuccess.scenarioProfile, 3, {
        preferRecent: false,
        preferSuccessTraces: false,
        preferFailureTraces: true,
        avoidStaleTraces: false
      });
      const freshSuccessFirst = await retrieveSimilar(cwd, "fix failing test", recentSuccess.scenarioProfile, 3, {
        preferRecent: true,
        preferSuccessTraces: true,
        preferFailureTraces: false,
        avoidStaleTraces: true
      });

      expect(failureFirst[0]?.traceId).toBe("recent_failure");
      expect(freshSuccessFirst[0]?.traceId).toBe("recent_success");
      expect(freshSuccessFirst.map((trace) => trace.traceId).indexOf("recent_success")).toBeLessThan(
        freshSuccessFirst.map((trace) => trace.traceId).indexOf("stale_success")
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports rejected trace retrieval candidates when top-k truncates memory", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-trace-rejections-"));
    try {
      await addTrace(cwd, makeTrace("fix failing test", "success", { traceId: "trace_a" }));
      await addTrace(cwd, makeTrace("fix failing test", "success", { traceId: "trace_b" }));
      await addTrace(cwd, makeTrace("fix failing test", "success", { traceId: "trace_c" }));

      const diagnostics = await retrieveSimilarWithDiagnostics(
        cwd,
        "fix failing test",
        makeTrace("fix failing test", "success").scenarioProfile,
        1
      );

      expect(diagnostics.selected).toHaveLength(1);
      expect(diagnostics.consideredCount).toBe(3);
      expect(diagnostics.rejected).toHaveLength(2);
      expect(diagnostics.rejected.every((item) => item.reason === "topk_overflow")).toBe(true);
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

  it("falls back to global selected policies when scenario-scoped policies are absent", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "tedge-global-policy-select-"));
    try {
      const global = {
        ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
        policyId: "global_selected_policy",
        routingPolicy: { ...defaultOrchestrationPolicy().routingPolicy, routingPreference: "quality" as const },
        metadata: { ...defaultOrchestrationPolicy().metadata, source: "selected" as const, fitness: 777 }
      };
      await savePolicyScore(cwd, global);

      const scoped = await loadBestPolicy(cwd, "debugging");

      expect(scoped.policyId).toBe("global_selected_policy");
      expect(scoped.routingPolicy.routingPreference).toBe("quality");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("mutates every runtime-wired policy genome family", () => {
    const base = defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z");
    const variants = Array.from({ length: ORCHESTRATION_POLICY_MUTATION_OPERATOR_COUNT }, (_, index) => mutatePolicy(base, index));

    expect(variants).toHaveLength(ORCHESTRATION_POLICY_MUTATION_OPERATOR_COUNT);
    expect(new Set(variants.map((item) => item.metadata.mutation)).size).toBe(ORCHESTRATION_POLICY_MUTATION_OPERATOR_COUNT);
    expect(changes(variants, base, (item) => item.contractPolicy.contractDepth)).toBe(true);
    expect(changes(variants, base, (item) => item.contractPolicy.successCriteriaCount)).toBe(true);
    expect(changes(variants, base, (item) => item.contractPolicy.requireEvidence)).toBe(true);
    expect(changes(variants, base, (item) => item.tracePolicy.traceTopK)).toBe(true);
    expect(changes(variants, base, (item) => item.tracePolicy.preferRecent)).toBe(true);
    expect(changes(variants, base, (item) => item.tracePolicy.preferSuccessTraces)).toBe(true);
    expect(changes(variants, base, (item) => item.tracePolicy.preferFailureTraces)).toBe(true);
    expect(changes(variants, base, (item) => item.tracePolicy.avoidStaleTraces)).toBe(true);
    expect(changes(variants, base, (item) => item.planningPolicy.maxStepsMode)).toBe(true);
    expect(changes(variants, base, (item) => item.planningPolicy.allowParallelRoles)).toBe(true);
    expect(changes(variants, base, (item) => item.planningPolicy.requirePlanStepEvidenceBinding)).toBe(true);
    expect(changes(variants, base, (item) => item.routingPolicy.routingPreference)).toBe(true);
    expect(changes(variants, base, (item) => item.routingPolicy.reviewerThreshold)).toBe(true);
    expect(changes(variants, base, (item) => item.routingPolicy.judgeThreshold)).toBe(true);
    expect(changes(variants, base, (item) => item.toolRoutingPolicy.preference)).toBe(true);
    expect(variants.every((item) => item.toolRoutingPolicy.allowCandidateSkills === false)).toBe(true);
    expect(variants.every((item) => item.toolRoutingPolicy.requireValidation === true)).toBe(true);
    expect(changes(variants, base, (item) => item.verificationPolicy.verificationStrictness)).toBe(true);
    expect(changes(variants, base, (item) => item.verificationPolicy.requireEvidencePacket)).toBe(true);
    expect(changes(variants, base, (item) => item.verificationPolicy.requireCommandValidationForPatch)).toBe(true);
    expect(changes(variants, base, (item) => item.verificationPolicy.requireReviewerForHighRisk)).toBe(true);
    expect(changes(variants, base, (item) => item.repairPolicy.maxRepairRounds)).toBe(true);
    expect(changes(variants, base, (item) => item.repairPolicy.retryOnMissingEvidence)).toBe(true);
    expect(changes(variants, base, (item) => item.repairPolicy.retryOnFailedVerification)).toBe(true);
    expect(changes(variants, base, (item) => item.repairPolicy.stopOnRecurringFailure)).toBe(true);
    expect(changes(variants, base, (item) => item.stopPolicy.stopMode)).toBe(true);
    expect(changes(variants, base, (item) => item.stopPolicy.allowPartialCompletion)).toBe(true);
    expect(changes(variants, base, (item) => item.stopPolicy.escalateWhenAmbiguous)).toBe(true);
    expect(variants.every((item) => item.schemaVersion === base.schemaVersion)).toBe(true);
    expect(variants.every((item) => item.metadata.parentPolicyIds.includes(base.policyId))).toBe(true);
  });

  it("scores different policy variants differently over the same trace set", () => {
    const base = defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z");
    const strictQuality = {
      ...base,
      policyId: "strict_quality",
      contractPolicy: { ...base.contractPolicy, contractDepth: "strict" as const },
      routingPolicy: { ...base.routingPolicy, routingPreference: "quality" as const, reviewerThreshold: "low" as const, judgeThreshold: "medium" as const },
      verificationPolicy: { ...base.verificationPolicy, verificationStrictness: "strict" as const },
      stopPolicy: { ...base.stopPolicy, stopMode: "evidence_strict" as const, allowPartialCompletion: false }
    };
    const lightCheap = {
      ...base,
      policyId: "light_cheap",
      contractPolicy: { ...base.contractPolicy, contractDepth: "light" as const, requireEvidence: false },
      routingPolicy: { ...base.routingPolicy, routingPreference: "cheap" as const, reviewerThreshold: "high" as const, judgeThreshold: "high" as const },
      verificationPolicy: { ...base.verificationPolicy, verificationStrictness: "light" as const, requireEvidencePacket: false },
      stopPolicy: { ...base.stopPolicy, stopMode: "early" as const, allowPartialCompletion: true }
    };
    const successTrace = makeTrace("fix failing test", "success");
    const partialTrace = makeTrace("fix failing test", "partial");

    const strictFitness = evaluatePolicyFitness(strictQuality, successTrace).finalFitness;
    const cheapFitness = evaluatePolicyFitness(lightCheap, successTrace).finalFitness;
    const evolved = evolvePoliciesOffline({
      basePolicy: strictQuality,
      traces: [successTrace, partialTrace],
      maxPolicyVariants: 4,
      eliteRetention: 2
    });

    expect(strictFitness).not.toBe(cheapFitness);
    expect(new Set(evolved.scored.map((item) => item.fitness.finalFitness)).size).toBeGreaterThan(1);
    expect(evolved.scored.every((item) => item.fitness.policyAlignmentScore !== undefined)).toBe(true);
  });

  it("uses persisted trace completeness during offline fitness scoring", () => {
    const policy = {
      ...defaultOrchestrationPolicy("2026-06-10T00:00:00.000Z"),
      verificationPolicy: { ...defaultOrchestrationPolicy().verificationPolicy, verificationStrictness: "strict" as const }
    };
    const trace = {
      ...makeTrace("fix failing test", "success"),
      evidenceSummary: {
        ...makeTrace("fix failing test", "success").evidenceSummary,
        evidenceScore: 100
      },
      traceCompleteness: { score: 100, missing: [] }
    };

    const fitness = evaluatePolicyFitness(policy, trace);

    expect(fitness.traceCompletenessScore).toBe(100);
    expect(fitness.riskPenalty).toBe(0);
  });
});

function changes<T>(variants: ObjectiveTracePolicy[], base: ObjectiveTracePolicy, read: (policy: ObjectiveTracePolicy) => T): boolean {
  return variants.some((variant) => read(variant) !== read(base));
}

type ObjectiveTracePolicy = ReturnType<typeof defaultOrchestrationPolicy>;

function makeTrace(
  goal: string,
  status: ObjectiveTraceV1["outcome"]["finalStatus"],
  overrides: { traceId?: string; createdAt?: string } = {}
): ObjectiveTraceV1 {
  const workflowIntent = workflowIntentFixture(goal, "patch");
  const scenarioProfile = scenarioProfileFixture("debugging", "patch");
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
    traceId: overrides.traceId ?? "trace_test",
    runId: "session_test",
    createdAt: overrides.createdAt ?? "2026-06-09T00:00:00.000Z",
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

function workflowIntentFixture(goal: string, workflowKind: WorkflowIntentDecision["workflowKind"]): WorkflowIntentDecision {
  const requiresPatchWorkflow = workflowKind === "patch" || workflowKind === "repair" || workflowKind === "vision_patch";
  return {
    intent: requiresPatchWorkflow ? "patch" : "inspect",
    requiresPatchWorkflow,
    workflowKind,
    confidence: 1,
    reason: `Test fixture declares ${workflowKind} workflow for ${goal}.`,
    provider: "test_fixture",
    model: "semantic-fixture",
    fallbackUsed: false
  };
}

function scenarioProfileFixture(scenarioType: ScenarioProfile["scenarioType"], workflowKind: ScenarioProfile["likelyWorkflowKind"]): ScenarioProfile {
  return {
    scenarioType,
    userIntent: `${scenarioType} fixture intent`,
    expectedDeliverable: workflowKind === "read_only" ? "read-only answer with evidence" : "patch workflow evidence",
    ambiguityLevel: "low",
    likelyWorkflowKind: workflowKind,
    riskSignals: ["correctness_critical"],
    evidenceNeeds: ["event ledger", "patch diff", "review decision", "judge decision"],
    suggestedRoles: ["planner", "explorer", "coder_a", "reviewer", "judge", "runner", "summarizer"]
  };
}
