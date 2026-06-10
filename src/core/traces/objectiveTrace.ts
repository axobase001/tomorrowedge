import type { AgentRole } from "../../schemas/agentTask.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { ContractVerificationResult, ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { ScenarioProfile } from "../scenarios/scenarioTypes.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import type { OrchestrationPolicyGenome } from "../orchestrationPolicy/orchestrationPolicy.js";

export type ObjectiveTracePolicySummary = {
  policyId: string;
  schemaVersion: OrchestrationPolicyGenome["schemaVersion"];
  source: OrchestrationPolicyGenome["metadata"]["source"];
  scenarioType?: OrchestrationPolicyGenome["metadata"]["scenarioType"];
  mutation?: string;
  fitness?: number;
  contractDepth: OrchestrationPolicyGenome["contractPolicy"]["contractDepth"];
  traceTopK: number;
  preferRecent: boolean;
  preferSuccessTraces: boolean;
  preferFailureTraces: boolean;
  avoidStaleTraces: boolean;
  maxStepsMode: OrchestrationPolicyGenome["planningPolicy"]["maxStepsMode"];
  allowParallelRoles: boolean;
  routingPreference: OrchestrationPolicyGenome["routingPolicy"]["routingPreference"];
  reviewerThreshold: OrchestrationPolicyGenome["routingPolicy"]["reviewerThreshold"];
  judgeThreshold: OrchestrationPolicyGenome["routingPolicy"]["judgeThreshold"];
  verificationStrictness: OrchestrationPolicyGenome["verificationPolicy"]["verificationStrictness"];
  maxRepairRounds: number;
  stopMode: OrchestrationPolicyGenome["stopPolicy"]["stopMode"];
  allowPartialCompletion: boolean;
};

export type ObjectiveTraceV1 = {
  schemaVersion: "objective-trace/v1";
  traceId: string;
  runId: string;
  createdAt: string;
  goal: string;
  scenarioProfile: ScenarioProfile;
  policySummary?: ObjectiveTracePolicySummary;
  contract: ObjectiveContractV1;
  contractVerification: ContractVerificationResult;
  planSummary: {
    workflowKind: WorkflowKind;
    steps: string[];
    allowedPhases: EventPhase[];
    verificationCommands: string[];
  };
  roleGraphSummary: {
    rolesUsed: AgentRole[];
    routingDecisions: string[];
    fallbackDecisions: string[];
  };
  executionSummary: {
    actions: string[];
    toolCalls: string[];
    observations: string[];
    shellRuns: number;
    filesTouched: string[];
  };
  evidenceSummary: {
    evidencePacketRefs: string[];
    requiredEvidenceSatisfied: string[];
    missingEvidence: string[];
    evidenceScore: number;
  };
  verificationSummary: {
    status: "success" | "partial" | "failure" | "unsafe" | "uncertain";
    passedCriteria: string[];
    failedCriteria: string[];
    reviewerDecision?: string;
    judgeDecision?: string;
  };
  repairSummary: {
    repairAttempts: number;
    recovered: boolean;
    recurringFailurePattern?: string;
  };
  costSummary: {
    tokens?: number;
    toolCalls: number;
    shellRuns: number;
    wallTimeMs?: number;
    estimatedCostUsd?: number;
  };
  feedback: {
    userRating?: number;
    userComment?: string;
    implicitSignals?: string[];
  };
  traceCompleteness?: {
    score: number;
    missing: string[];
  };
  outcome: {
    finalStatus: "success" | "partial" | "failure" | "unsafe" | "aborted";
    failureType?: string;
    lessons: string[];
  };
};
