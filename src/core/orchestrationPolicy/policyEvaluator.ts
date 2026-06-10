import type { AgentGraphState } from "../agentGraph/state.js";
import { scoreContractQuality } from "../contracts/contractScoring.js";
import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import type { OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

export type PolicyFitness = {
  successScore: number;
  contractQualityScore: number;
  evidenceScore: number;
  traceCompletenessScore: number;
  repairRecoveryScore: number;
  policyAlignmentScore: number;
  costPenalty: number;
  riskPenalty: number;
  instabilityPenalty: number;
  finalFitness: number;
};

export function evaluatePolicyFitness(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1, state?: AgentGraphState): PolicyFitness {
  const successScore = trace.outcome.finalStatus === "success" ? 100 : trace.outcome.finalStatus === "partial" ? 55 : trace.outcome.finalStatus === "failure" ? 20 : 0;
  const contractQualityScore = scoreContractQuality(trace.contract, trace.contractVerification);
  const evidenceScore = trace.evidenceSummary.evidenceScore;
  const traceCompletenessScore = traceCompletenessScoreForTrace(trace, state);
  const repairRecoveryScore = repairScoreForPolicy(policy, trace);
  const policyAlignmentScore = policyAlignmentForTrace(policy, trace, traceCompletenessScore);
  const costPenalty = costPenaltyForPolicy(policy, trace);
  const riskPenalty = riskPenaltyForPolicy(policy, trace, evidenceScore, traceCompletenessScore);
  const instabilityPenalty = state?.events.some((event) => event.type === "provider_fallback" || event.type === "fallback_to_native") ? 5 : 0;
  const finalFitness = Math.round(
    1.0 * successScore
    + 0.8 * contractQualityScore
    + 0.8 * evidenceScore
    + 0.6 * traceCompletenessScore
    + 0.5 * repairRecoveryScore
    + 0.7 * policyAlignmentScore
    - 0.4 * costPenalty
    - 1.0 * riskPenalty
    - 0.6 * instabilityPenalty
  );
  return {
    successScore,
    contractQualityScore,
    evidenceScore,
    traceCompletenessScore,
    repairRecoveryScore,
    policyAlignmentScore,
    costPenalty,
    riskPenalty,
    instabilityPenalty,
    finalFitness
  };
}

function traceCompletenessScoreForTrace(trace: ObjectiveTraceV1, state?: AgentGraphState): number {
  const score = state?.traceCompleteness?.score ?? trace.traceCompleteness?.score ?? trace.evidenceSummary.evidenceScore;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function aggregatePolicyFitness(policy: OrchestrationPolicyGenome, traces: ObjectiveTraceV1[], state?: AgentGraphState): PolicyFitness {
  if (!traces.length) return zeroFitness();
  const scored = traces.map((trace) => evaluatePolicyFitness(policy, trace, state));
  const total = scored.reduce((acc, item) => ({
    successScore: acc.successScore + item.successScore,
    contractQualityScore: acc.contractQualityScore + item.contractQualityScore,
    evidenceScore: acc.evidenceScore + item.evidenceScore,
    traceCompletenessScore: acc.traceCompletenessScore + item.traceCompletenessScore,
    repairRecoveryScore: acc.repairRecoveryScore + item.repairRecoveryScore,
    policyAlignmentScore: acc.policyAlignmentScore + item.policyAlignmentScore,
    costPenalty: acc.costPenalty + item.costPenalty,
    riskPenalty: acc.riskPenalty + item.riskPenalty,
    instabilityPenalty: acc.instabilityPenalty + item.instabilityPenalty,
    finalFitness: acc.finalFitness + item.finalFitness
  }), zeroFitness());
  return {
    successScore: roundedAverage(total.successScore, traces.length),
    contractQualityScore: roundedAverage(total.contractQualityScore, traces.length),
    evidenceScore: roundedAverage(total.evidenceScore, traces.length),
    traceCompletenessScore: roundedAverage(total.traceCompletenessScore, traces.length),
    repairRecoveryScore: roundedAverage(total.repairRecoveryScore, traces.length),
    policyAlignmentScore: roundedAverage(total.policyAlignmentScore, traces.length),
    costPenalty: roundedAverage(total.costPenalty, traces.length),
    riskPenalty: roundedAverage(total.riskPenalty, traces.length),
    instabilityPenalty: roundedAverage(total.instabilityPenalty, traces.length),
    finalFitness: Math.round(total.finalFitness / traces.length)
  };
}

export function policyWithFitness(policy: OrchestrationPolicyGenome, fitness: PolicyFitness): OrchestrationPolicyGenome {
  return { ...policy, metadata: { ...policy.metadata, fitness: fitness.finalFitness, source: "selected" } };
}

function repairScoreForPolicy(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1): number {
  const attempts = trace.repairSummary.repairAttempts;
  if (!attempts) return policy.repairPolicy.maxRepairRounds === 0 ? 70 : 55;
  if (attempts > policy.repairPolicy.maxRepairRounds) return 10;
  if (trace.repairSummary.recovered) return policy.repairPolicy.retryOnFailedVerification ? 95 : 55;
  if (policy.repairPolicy.stopOnRecurringFailure && trace.repairSummary.recurringFailurePattern) return 50;
  return policy.repairPolicy.retryOnFailedVerification ? 35 : 60;
}

function policyAlignmentForTrace(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1, traceCompletenessScore: number): number {
  let score = 50;
  const highRisk = trace.contract.riskLevel === "high" || trace.contract.reasoningSensitivity === "high";
  const missingEvidence = trace.evidenceSummary.missingEvidence.length;
  const partial = trace.outcome.finalStatus === "partial";
  const success = trace.outcome.finalStatus === "success";

  if (policy.contractPolicy.contractDepth === "strict") score += trace.contractVerification.score >= 85 ? 12 : -10;
  if (policy.contractPolicy.contractDepth === "light") score += missingEvidence ? 6 : -4;
  if (policy.verificationPolicy.verificationStrictness === "strict") score += trace.evidenceSummary.evidenceScore >= 90 && traceCompletenessScore >= 85 ? 18 : -18;
  if (policy.verificationPolicy.verificationStrictness === "light") score += missingEvidence || partial ? 8 : -5;
  if (policy.planningPolicy.requirePlanStepEvidenceBinding) score += trace.evidenceSummary.evidenceScore >= 75 ? 8 : -8;
  if (policy.routingPolicy.routingPreference === "quality") score += highRisk ? 12 : success ? 2 : -2;
  if (policy.routingPolicy.routingPreference === "cheap") score += highRisk ? -12 : trace.costSummary.estimatedCostUsd && trace.costSummary.estimatedCostUsd > 0.2 ? 10 : 3;
  if (policy.stopPolicy.allowPartialCompletion) score += partial ? 10 : 0;
  if (!policy.stopPolicy.allowPartialCompletion && partial) score -= 16;
  if (policy.stopPolicy.stopMode === "evidence_strict") score += traceCompletenessScore >= 90 && !missingEvidence ? 12 : -14;
  if (policy.stopPolicy.stopMode === "early") score += partial ? 7 : -3;
  if (policy.stopPolicy.escalateWhenAmbiguous && trace.contract.userScenario.ambiguityLevel !== "low") score += 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function costPenaltyForPolicy(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1): number {
  const cost = trace.costSummary.estimatedCostUsd ? Math.min(50, trace.costSummary.estimatedCostUsd * 10) : 0;
  if (policy.routingPolicy.routingPreference === "cheap") return cost * 1.3;
  if (policy.routingPolicy.routingPreference === "quality") return cost * 0.7;
  if (policy.routingPolicy.routingPreference === "privacy") return cost * 1.1;
  return cost;
}

function riskPenaltyForPolicy(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1, evidenceScore: number, traceCompletenessScore: number): number {
  let penalty = trace.contractVerification.violations.length ? 35 : 0;
  if (policy.verificationPolicy.verificationStrictness === "strict" && (evidenceScore < 90 || traceCompletenessScore < 90)) penalty += 20;
  if (policy.contractPolicy.contractDepth === "light" && trace.contract.riskLevel === "high") penalty += 18;
  if (!policy.stopPolicy.allowPartialCompletion && trace.outcome.finalStatus === "partial") penalty += 12;
  if (policy.repairPolicy.maxRepairRounds < trace.repairSummary.repairAttempts) penalty += 20;
  return penalty;
}

function zeroFitness(): PolicyFitness {
  return {
    successScore: 0,
    contractQualityScore: 0,
    evidenceScore: 0,
    traceCompletenessScore: 0,
    repairRecoveryScore: 0,
    policyAlignmentScore: 0,
    costPenalty: 0,
    riskPenalty: 0,
    instabilityPenalty: 0,
    finalFitness: 0
  };
}

function roundedAverage(total: number, count: number): number {
  return Math.round(total / count);
}
