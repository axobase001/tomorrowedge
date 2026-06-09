import type { ScenarioType } from "../scenarios/scenarioTypes.js";

export type SelfIterationMode = "off" | "trace_guided" | "offline_evolution" | "experimental_online";

export type OrchestrationPolicyGenome = {
  policyId: string;
  schemaVersion: "orchestration-policy/v1";
  contractPolicy: {
    contractDepth: "light" | "medium" | "strict";
    successCriteriaCount: number;
    requireFailureCriteria: boolean;
    requireEvidence: boolean;
    requireStopCondition: boolean;
  };
  tracePolicy: {
    traceTopK: number;
    preferRecent: boolean;
    preferSuccessTraces: boolean;
    preferFailureTraces: boolean;
    avoidStaleTraces: boolean;
  };
  planningPolicy: {
    maxStepsMode: "conservative" | "balanced" | "aggressive";
    allowParallelRoles: boolean;
    requirePlanStepEvidenceBinding: boolean;
  };
  routingPolicy: {
    routingPreference: "cheap" | "balanced" | "quality" | "privacy";
    reviewerThreshold: "low" | "medium" | "high";
    judgeThreshold: "medium" | "high";
  };
  verificationPolicy: {
    verificationStrictness: "light" | "medium" | "strict";
    requireEvidencePacket: boolean;
    requireCommandValidationForPatch: boolean;
    requireReviewerForHighRisk: boolean;
  };
  repairPolicy: {
    maxRepairRounds: number;
    retryOnMissingEvidence: boolean;
    retryOnFailedVerification: boolean;
    stopOnRecurringFailure: boolean;
  };
  stopPolicy: {
    stopMode: "early" | "balanced" | "evidence_strict";
    allowPartialCompletion: boolean;
    escalateWhenAmbiguous: boolean;
  };
  metadata: {
    createdAt: string;
    source: "default" | "mutated" | "selected" | "manual";
    parentPolicyIds: string[];
    fitness?: number;
    scenarioType?: ScenarioType;
  };
};

export function defaultOrchestrationPolicy(now = new Date().toISOString()): OrchestrationPolicyGenome {
  return {
    policyId: "default_trace_guided_policy",
    schemaVersion: "orchestration-policy/v1",
    contractPolicy: {
      contractDepth: "medium",
      successCriteriaCount: 3,
      requireFailureCriteria: true,
      requireEvidence: true,
      requireStopCondition: true
    },
    tracePolicy: {
      traceTopK: 3,
      preferRecent: true,
      preferSuccessTraces: true,
      preferFailureTraces: true,
      avoidStaleTraces: true
    },
    planningPolicy: {
      maxStepsMode: "balanced",
      allowParallelRoles: true,
      requirePlanStepEvidenceBinding: true
    },
    routingPolicy: {
      routingPreference: "balanced",
      reviewerThreshold: "medium",
      judgeThreshold: "high"
    },
    verificationPolicy: {
      verificationStrictness: "medium",
      requireEvidencePacket: true,
      requireCommandValidationForPatch: true,
      requireReviewerForHighRisk: true
    },
    repairPolicy: {
      maxRepairRounds: 2,
      retryOnMissingEvidence: true,
      retryOnFailedVerification: true,
      stopOnRecurringFailure: true
    },
    stopPolicy: {
      stopMode: "balanced",
      allowPartialCompletion: true,
      escalateWhenAmbiguous: true
    },
    metadata: {
      createdAt: now,
      source: "default",
      parentPolicyIds: []
    }
  };
}

