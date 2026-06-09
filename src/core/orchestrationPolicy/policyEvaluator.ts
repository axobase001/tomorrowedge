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
  costPenalty: number;
  riskPenalty: number;
  instabilityPenalty: number;
  finalFitness: number;
};

export function evaluatePolicyFitness(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1, state?: AgentGraphState): PolicyFitness {
  const successScore = trace.outcome.finalStatus === "success" ? 100 : trace.outcome.finalStatus === "partial" ? 55 : trace.outcome.finalStatus === "failure" ? 20 : 0;
  const contractQualityScore = scoreContractQuality(trace.contract, trace.contractVerification);
  const evidenceScore = trace.evidenceSummary.evidenceScore;
  const traceCompletenessScore = state?.traceCompleteness?.score ?? 70;
  const repairRecoveryScore = trace.repairSummary.repairAttempts ? trace.repairSummary.recovered ? 80 : 25 : 50;
  const costPenalty = trace.costSummary.estimatedCostUsd ? Math.min(50, trace.costSummary.estimatedCostUsd * 10) : 0;
  const riskPenalty = trace.contractVerification.violations.length ? 35 : 0;
  const instabilityPenalty = state?.events.some((event) => event.type === "provider_fallback" || event.type === "fallback_to_native") ? 5 : 0;
  const finalFitness = Math.round(
    1.0 * successScore
    + 0.8 * contractQualityScore
    + 0.8 * evidenceScore
    + 0.6 * traceCompletenessScore
    + 0.5 * repairRecoveryScore
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
    costPenalty,
    riskPenalty,
    instabilityPenalty,
    finalFitness
  };
}

export function policyWithFitness(policy: OrchestrationPolicyGenome, fitness: PolicyFitness): OrchestrationPolicyGenome {
  return { ...policy, metadata: { ...policy.metadata, fitness: fitness.finalFitness, source: "selected" } };
}

