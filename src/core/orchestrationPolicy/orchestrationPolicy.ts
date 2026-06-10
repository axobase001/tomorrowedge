import type { ScenarioType } from "../scenarios/scenarioTypes.js";

export type SelfIterationMode = "off" | "trace_guided" | "offline_evolution" | "experimental_online";

export type OrchestrationPolicyGenome = {
  policyId: string;
  schemaVersion: "orchestration-policy/v1" | "orchestration-policy/v2";
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
  toolRoutingPolicy: {
    preference: "safe" | "trace_score" | "minimal_permissions";
    allowCandidateSkills: boolean;
    requireValidation: boolean;
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
  debatePolicy?: {
    maxStructuredRounds: number;
    requireClaimEvidence: boolean;
    blockOnUnresolvedCritical: boolean;
    allowPartialResolution: boolean;
  };
  taskGraphPolicy?: {
    requireTaskGraph: boolean;
    maxTaskNodes: number;
    requireDependencyValidation: boolean;
    stopOnInvalidGraph: boolean;
  };
  externalAgentPolicy?: {
    adapterStrictness: "off" | "warn" | "strict";
    requireTypedEnvelope: boolean;
    maxNormalizationRetries: number;
  };
  metadata: {
    createdAt: string;
    source: "default" | "mutated" | "selected" | "manual";
    parentPolicyIds: string[];
    mutation?: string;
    fitness?: number;
    scenarioType?: ScenarioType;
  };
};

export function defaultOrchestrationPolicy(now = new Date().toISOString()): OrchestrationPolicyGenome {
  return {
    policyId: "default_trace_guided_policy",
    schemaVersion: "orchestration-policy/v2",
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
    toolRoutingPolicy: {
      preference: "safe",
      allowCandidateSkills: false,
      requireValidation: true
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
    debatePolicy: {
      maxStructuredRounds: 3,
      requireClaimEvidence: true,
      blockOnUnresolvedCritical: true,
      allowPartialResolution: true
    },
    taskGraphPolicy: {
      requireTaskGraph: true,
      maxTaskNodes: 16,
      requireDependencyValidation: true,
      stopOnInvalidGraph: true
    },
    externalAgentPolicy: {
      adapterStrictness: "warn",
      requireTypedEnvelope: true,
      maxNormalizationRetries: 1
    },
    metadata: {
      createdAt: now,
      source: "default",
      parentPolicyIds: []
    }
  };
}

export function migratePolicyToV2(policy: OrchestrationPolicyGenome): OrchestrationPolicyGenome {
  const base = defaultOrchestrationPolicy(policy.metadata.createdAt);
  return {
    ...base,
    ...policy,
    schemaVersion: "orchestration-policy/v2",
    debatePolicy: { ...base.debatePolicy!, ...(policy.debatePolicy ?? {}) },
    taskGraphPolicy: { ...base.taskGraphPolicy!, ...(policy.taskGraphPolicy ?? {}) },
    externalAgentPolicy: { ...base.externalAgentPolicy!, ...(policy.externalAgentPolicy ?? {}) },
    metadata: { ...base.metadata, ...policy.metadata }
  };
}
