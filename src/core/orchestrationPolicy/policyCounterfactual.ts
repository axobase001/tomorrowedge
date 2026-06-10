import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import { evaluatePolicyFitness, type PolicyFitness } from "./policyEvaluator.js";
import type { OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

export type PolicyCounterfactualReplay = {
  policyId: string;
  traceId: string;
  originalStatus: ObjectiveTraceV1["outcome"]["finalStatus"];
  simulatedStatus: ObjectiveTraceV1["outcome"]["finalStatus"];
  fitness: PolicyFitness;
  baselineFitness?: PolicyFitness;
  deltas: {
    finalFitness?: number;
    evidenceScore: number;
    traceCompletenessScore: number;
    costPenalty: number;
    riskPenalty: number;
  };
  summary: string;
};

export type PolicyTournamentResult = {
  winnerPolicyId: string;
  evaluatedPolicies: number;
  traceCount: number;
  ranking: Array<{
    policyId: string;
    averageFitness: number;
    wins: number;
  }>;
};

export function simulatePolicyOnTrace(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1, baselinePolicy?: OrchestrationPolicyGenome): PolicyCounterfactualReplay {
  const projectedTrace = projectTraceForPolicy(policy, trace);
  const fitness = evaluatePolicyFitness(policy, projectedTrace);
  const baselineFitness = baselinePolicy ? evaluatePolicyFitness(baselinePolicy, trace) : undefined;
  const simulatedStatus = simulatedStatusForPolicy(policy, projectedTrace);
  return {
    policyId: policy.policyId,
    traceId: trace.traceId,
    originalStatus: trace.outcome.finalStatus,
    simulatedStatus,
    fitness,
    baselineFitness,
    deltas: {
      finalFitness: baselineFitness ? fitness.finalFitness - baselineFitness.finalFitness : undefined,
      evidenceScore: fitness.evidenceScore - trace.evidenceSummary.evidenceScore,
      traceCompletenessScore: fitness.traceCompletenessScore - (trace.traceCompleteness?.score ?? trace.evidenceSummary.evidenceScore),
      costPenalty: fitness.costPenalty - (baselineFitness?.costPenalty ?? 0),
      riskPenalty: fitness.riskPenalty - (baselineFitness?.riskPenalty ?? 0)
    },
    summary: `${policy.policyId} projects ${trace.traceId} as ${simulatedStatus} with fitness=${fitness.finalFitness}.`
  };
}

export function runPolicyTournament(policies: OrchestrationPolicyGenome[], traces: ObjectiveTraceV1[]): PolicyTournamentResult {
  const scored = policies.map((policy) => {
    const replays = traces.map((trace) => simulatePolicyOnTrace(policy, trace));
    const averageFitness = replays.length ? Math.round(replays.reduce((sum, replay) => sum + replay.fitness.finalFitness, 0) / replays.length) : 0;
    return { policyId: policy.policyId, averageFitness, wins: 0 };
  });
  for (const trace of traces) {
    const best = policies
      .map((policy) => simulatePolicyOnTrace(policy, trace))
      .sort((left, right) => right.fitness.finalFitness - left.fitness.finalFitness)[0];
    const row = scored.find((item) => item.policyId === best?.policyId);
    if (row) row.wins += 1;
  }
  const ranking = scored.sort((left, right) => right.averageFitness - left.averageFitness || right.wins - left.wins);
  return {
    winnerPolicyId: ranking[0]?.policyId ?? "none",
    evaluatedPolicies: policies.length,
    traceCount: traces.length,
    ranking
  };
}

function projectTraceForPolicy(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1): ObjectiveTraceV1 {
  const next = structuredClone(trace);
  if (policy.verificationPolicy.verificationStrictness === "strict" || policy.stopPolicy.stopMode === "evidence_strict") {
    const missing = new Set(next.evidenceSummary.missingEvidence);
    if (!next.evidenceSummary.evidencePacketRefs.length) missing.add("evidence packet");
    if ((next.traceCompleteness?.score ?? 0) < 90) missing.add("trace completeness");
    next.evidenceSummary.missingEvidence = [...missing];
    next.evidenceSummary.evidenceScore = Math.min(next.evidenceSummary.evidenceScore, next.evidenceSummary.missingEvidence.length ? 65 : 100);
  }
  if (policy.contractPolicy.contractDepth === "light" && policy.verificationPolicy.verificationStrictness === "light") {
    next.evidenceSummary.evidenceScore = Math.max(next.evidenceSummary.evidenceScore, 70);
  }
  if (policy.routingPolicy.routingPreference === "cheap") {
    next.costSummary.estimatedCostUsd = (next.costSummary.estimatedCostUsd ?? 0.1) * 0.7;
  }
  if (policy.routingPolicy.routingPreference === "quality") {
    next.costSummary.estimatedCostUsd = (next.costSummary.estimatedCostUsd ?? 0.1) * 1.15;
  }
  return next;
}

function simulatedStatusForPolicy(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1): ObjectiveTraceV1["outcome"]["finalStatus"] {
  if (trace.contractVerification.status === "failed") return "unsafe";
  const missing = trace.evidenceSummary.missingEvidence.length;
  const strict = policy.verificationPolicy.verificationStrictness === "strict" || policy.stopPolicy.stopMode === "evidence_strict";
  if (strict && missing) return policy.stopPolicy.allowPartialCompletion ? "partial" : "failure";
  if (trace.outcome.finalStatus === "partial" && !policy.stopPolicy.allowPartialCompletion) return "failure";
  return trace.outcome.finalStatus;
}
