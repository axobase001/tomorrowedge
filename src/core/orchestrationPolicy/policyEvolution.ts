import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import { defaultOrchestrationPolicy, type OrchestrationPolicyGenome } from "./orchestrationPolicy.js";
import { evaluatePolicyFitness, type PolicyFitness } from "./policyEvaluator.js";
import { mutatePolicy } from "./policyMutation.js";

export type PolicyEvolutionResult = {
  basePolicy: OrchestrationPolicyGenome;
  variants: OrchestrationPolicyGenome[];
  scored: Array<{ policy: OrchestrationPolicyGenome; fitness: PolicyFitness }>;
  selected: OrchestrationPolicyGenome[];
};

export function evolvePoliciesOffline(input: {
  basePolicy?: OrchestrationPolicyGenome;
  traces: ObjectiveTraceV1[];
  maxPolicyVariants?: number;
  eliteRetention?: number;
}): PolicyEvolutionResult {
  const basePolicy = input.basePolicy ?? defaultOrchestrationPolicy();
  const variants = Array.from({ length: Math.max(0, input.maxPolicyVariants ?? 4) }, (_, index) => mutatePolicy(basePolicy, index));
  const sampleTrace = input.traces[0];
  const scored = [basePolicy, ...variants].map((policy) => ({
    policy,
    fitness: sampleTrace
      ? evaluatePolicyFitness(policy, sampleTrace)
      : {
          successScore: 0,
          contractQualityScore: 0,
          evidenceScore: 0,
          traceCompletenessScore: 0,
          repairRecoveryScore: 0,
          costPenalty: 0,
          riskPenalty: 0,
          instabilityPenalty: 0,
          finalFitness: 0
        }
  }));
  const selected = scored
    .sort((left, right) => right.fitness.finalFitness - left.fitness.finalFitness)
    .slice(0, Math.max(1, input.eliteRetention ?? 2))
    .map((item) => ({ ...item.policy, metadata: { ...item.policy.metadata, fitness: item.fitness.finalFitness, source: "selected" as const } }));
  return { basePolicy, variants, scored, selected };
}

