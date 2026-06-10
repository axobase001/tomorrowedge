import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import { defaultOrchestrationPolicy, type OrchestrationPolicyGenome } from "./orchestrationPolicy.js";
import { aggregatePolicyFitness, type PolicyFitness } from "./policyEvaluator.js";
import { runPolicyTournament, type PolicyTournamentResult } from "./policyCounterfactual.js";
import { mutatePolicy } from "./policyMutation.js";

export type PolicyEvolutionResult = {
  basePolicy: OrchestrationPolicyGenome;
  variants: OrchestrationPolicyGenome[];
  scored: Array<{ policy: OrchestrationPolicyGenome; fitness: PolicyFitness }>;
  selected: OrchestrationPolicyGenome[];
  tournament: PolicyTournamentResult;
};

export function evolvePoliciesOffline(input: {
  basePolicy?: OrchestrationPolicyGenome;
  traces: ObjectiveTraceV1[];
  maxPolicyVariants?: number;
  eliteRetention?: number;
}): PolicyEvolutionResult {
  const basePolicy = input.basePolicy ?? defaultOrchestrationPolicy();
  const variants = Array.from({ length: Math.max(0, input.maxPolicyVariants ?? 4) }, (_, index) => mutatePolicy(basePolicy, index));
  const scored = [basePolicy, ...variants].map((policy) => ({
    policy,
    fitness: aggregatePolicyFitness(policy, input.traces)
  }));
  const selected = scored
    .sort((left, right) => right.fitness.finalFitness - left.fitness.finalFitness)
    .slice(0, Math.max(1, input.eliteRetention ?? 2))
    .map((item) => ({ ...item.policy, metadata: { ...item.policy.metadata, fitness: item.fitness.finalFitness, source: "selected" as const } }));
  const tournament = runPolicyTournament([basePolicy, ...variants], input.traces);
  return { basePolicy, variants, scored, selected, tournament };
}
