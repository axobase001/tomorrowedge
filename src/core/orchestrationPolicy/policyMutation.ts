import { makeId } from "../../utils/ids.js";
import type { OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

type PolicyMutationOperator = {
  name: string;
  apply: (policy: OrchestrationPolicyGenome) => void;
};

const policyMutationOperators: PolicyMutationOperator[] = [
  {
    name: "contract_strict",
    apply: (policy) => {
      policy.contractPolicy.contractDepth = "strict";
      policy.contractPolicy.successCriteriaCount = clamp(policy.contractPolicy.successCriteriaCount + 2, 1, 6);
      policy.contractPolicy.requireFailureCriteria = true;
      policy.contractPolicy.requireEvidence = true;
      policy.contractPolicy.requireStopCondition = true;
    }
  },
  {
    name: "contract_light",
    apply: (policy) => {
      policy.contractPolicy.contractDepth = "light";
      policy.contractPolicy.successCriteriaCount = clamp(policy.contractPolicy.successCriteriaCount - 1, 1, 6);
      policy.contractPolicy.requireFailureCriteria = false;
      policy.contractPolicy.requireEvidence = false;
      policy.contractPolicy.requireStopCondition = false;
    }
  },
  {
    name: "trace_success_recent",
    apply: (policy) => {
      policy.tracePolicy.traceTopK = clamp(policy.tracePolicy.traceTopK + 1, 1, 8);
      policy.tracePolicy.preferRecent = true;
      policy.tracePolicy.preferSuccessTraces = true;
      policy.tracePolicy.preferFailureTraces = false;
      policy.tracePolicy.avoidStaleTraces = true;
    }
  },
  {
    name: "trace_failure_exploration",
    apply: (policy) => {
      policy.tracePolicy.traceTopK = clamp(policy.tracePolicy.traceTopK + 2, 1, 8);
      policy.tracePolicy.preferRecent = false;
      policy.tracePolicy.preferSuccessTraces = false;
      policy.tracePolicy.preferFailureTraces = true;
      policy.tracePolicy.avoidStaleTraces = false;
    }
  },
  {
    name: "planning_serial_evidence",
    apply: (policy) => {
      policy.planningPolicy.maxStepsMode = "conservative";
      policy.planningPolicy.allowParallelRoles = false;
      policy.planningPolicy.requirePlanStepEvidenceBinding = true;
    }
  },
  {
    name: "planning_broad_exploration",
    apply: (policy) => {
      policy.planningPolicy.maxStepsMode = "aggressive";
      policy.planningPolicy.allowParallelRoles = true;
      policy.planningPolicy.requirePlanStepEvidenceBinding = false;
    }
  },
  {
    name: "routing_quality_governance",
    apply: (policy) => {
      policy.routingPolicy.routingPreference = "quality";
      policy.routingPolicy.reviewerThreshold = "low";
      policy.routingPolicy.judgeThreshold = "medium";
    }
  },
  {
    name: "routing_cost_saver",
    apply: (policy) => {
      policy.routingPolicy.routingPreference = "cheap";
      policy.routingPolicy.reviewerThreshold = "high";
      policy.routingPolicy.judgeThreshold = "high";
    }
  },
  {
    name: "routing_privacy_first",
    apply: (policy) => {
      policy.routingPolicy.routingPreference = "privacy";
      policy.routingPolicy.reviewerThreshold = "medium";
      policy.routingPolicy.judgeThreshold = "high";
    }
  },
  {
    name: "verification_strict",
    apply: (policy) => {
      policy.verificationPolicy.verificationStrictness = "strict";
      policy.verificationPolicy.requireEvidencePacket = true;
      policy.verificationPolicy.requireCommandValidationForPatch = true;
      policy.verificationPolicy.requireReviewerForHighRisk = true;
    }
  },
  {
    name: "verification_light",
    apply: (policy) => {
      policy.verificationPolicy.verificationStrictness = "light";
      policy.verificationPolicy.requireEvidencePacket = false;
      policy.verificationPolicy.requireCommandValidationForPatch = false;
      policy.verificationPolicy.requireReviewerForHighRisk = false;
    }
  },
  {
    name: "repair_retry_more",
    apply: (policy) => {
      policy.repairPolicy.maxRepairRounds = clamp(policy.repairPolicy.maxRepairRounds + 1, 0, 5);
      policy.repairPolicy.retryOnMissingEvidence = true;
      policy.repairPolicy.retryOnFailedVerification = true;
      policy.repairPolicy.stopOnRecurringFailure = true;
    }
  },
  {
    name: "repair_stop_sooner",
    apply: (policy) => {
      policy.repairPolicy.maxRepairRounds = clamp(policy.repairPolicy.maxRepairRounds - 1, 0, 5);
      policy.repairPolicy.retryOnMissingEvidence = false;
      policy.repairPolicy.retryOnFailedVerification = false;
      policy.repairPolicy.stopOnRecurringFailure = false;
    }
  },
  {
    name: "stop_evidence_strict",
    apply: (policy) => {
      policy.stopPolicy.stopMode = "evidence_strict";
      policy.stopPolicy.allowPartialCompletion = false;
      policy.stopPolicy.escalateWhenAmbiguous = true;
    }
  },
  {
    name: "stop_early_advisory",
    apply: (policy) => {
      policy.stopPolicy.stopMode = "early";
      policy.stopPolicy.allowPartialCompletion = true;
      policy.stopPolicy.escalateWhenAmbiguous = false;
    }
  }
];

export const ORCHESTRATION_POLICY_MUTATION_OPERATOR_COUNT = policyMutationOperators.length;

export function mutatePolicy(policy: OrchestrationPolicyGenome, index = 0): OrchestrationPolicyGenome {
  const next: OrchestrationPolicyGenome = structuredClone(policy);
  const operator = policyMutationOperators[Math.abs(index) % policyMutationOperators.length]!;
  next.policyId = makeId("policy_mutation");
  next.metadata = {
    createdAt: new Date().toISOString(),
    source: "mutated",
    parentPolicyIds: [policy.policyId],
    mutation: operator.name,
    scenarioType: policy.metadata.scenarioType
  };
  operator.apply(next);
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
