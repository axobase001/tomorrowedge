import { makeId } from "../../utils/ids.js";
import type { OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

export function mutatePolicy(policy: OrchestrationPolicyGenome, index = 0): OrchestrationPolicyGenome {
  const next: OrchestrationPolicyGenome = structuredClone(policy);
  next.policyId = makeId("policy_mutation");
  next.metadata = {
    createdAt: new Date().toISOString(),
    source: "mutated",
    parentPolicyIds: [policy.policyId],
    scenarioType: policy.metadata.scenarioType
  };
  const mutation = index % 4;
  if (mutation === 0) next.contractPolicy.contractDepth = next.contractPolicy.contractDepth === "strict" ? "medium" : "strict";
  if (mutation === 1) next.tracePolicy.traceTopK = Math.max(1, Math.min(8, next.tracePolicy.traceTopK + 1));
  if (mutation === 2) next.verificationPolicy.verificationStrictness = next.verificationPolicy.verificationStrictness === "strict" ? "medium" : "strict";
  if (mutation === 3) next.repairPolicy.maxRepairRounds = Math.max(0, Math.min(5, next.repairPolicy.maxRepairRounds + 1));
  return next;
}

