import type { AgentRole } from "../../schemas/agentTask.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { RiskLevel, TaskType } from "../../schemas/plan.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import type { ScenarioType } from "../scenarios/scenarioTypes.js";

export type ObjectiveContractSource = "native" | "model" | "trace_guided" | "repaired";

export type ObjectiveContractV1 = {
  schemaVersion: "objective-contract/v1";
  contractId: string;
  createdAt: string;
  goal: string;
  normalizedGoal: string;
  scenarioType: ScenarioType;
  taskType: TaskType;
  workflowKind: WorkflowKind;
  localObjective: string;
  userScenario: {
    inferredUserIntent: string;
    expectedDeliverable: string;
    interactionMode: "answer" | "artifact" | "code_change" | "analysis" | "mixed";
    ambiguityLevel: "low" | "medium" | "high";
  };
  successCriteria: string[];
  failureCriteria: string[];
  requiredEvidence: string[];
  allowedPhases: EventPhase[];
  allowedRoles: AgentRole[];
  allowedTools: string[];
  forbiddenActions: string[];
  riskLevel: RiskLevel;
  reasoningSensitivity: "low" | "medium" | "high";
  budget: {
    maxSteps: number;
    maxRepairRounds: number;
    maxShellRuns: number;
    maxToolCalls: number;
    maxCostUsd?: number;
  };
  uncertaintyPolicy: {
    whenToAskUser: string[];
    whenToFallback: string[];
    whenToProceedWithAssumption: string[];
    whenToStop: string[];
  };
  stopCondition: {
    success: string[];
    partial: string[];
    failure: string[];
    unsafe: string[];
  };
  fallbackPolicy: {
    plannerFallback: string;
    executorFallback: string;
    verifierFallback: string;
    userEscalation: string;
  };
  verificationRubric: {
    requiredCommands: string[];
    requiredArtifacts: string[];
    evidenceChecks: string[];
    reviewerChecks: string[];
    judgeChecks: string[];
  };
  traceHints: {
    similarTraceIds: string[];
    reusedLessons: string[];
    avoidedFailurePatterns: string[];
  };
  source: ObjectiveContractSource;
  confidence: number;
};

export type ContractVerificationResult = {
  status: "passed" | "repaired" | "failed" | "downgraded";
  score: number;
  missing: string[];
  violations: string[];
  repairs: string[];
  downgradeReason?: string;
};

export type ContractArtifactSummary = {
  contractId: string;
  localObjective: string;
  scenarioType: ScenarioType;
  workflowKind: WorkflowKind;
  riskLevel: RiskLevel;
  source: ObjectiveContractSource;
  successCriteria: string[];
  requiredEvidence: string[];
  stopCondition: ObjectiveContractV1["stopCondition"];
};

export function summarizeObjectiveContract(contract: ObjectiveContractV1): ContractArtifactSummary {
  return {
    contractId: contract.contractId,
    localObjective: contract.localObjective,
    scenarioType: contract.scenarioType,
    workflowKind: contract.workflowKind,
    riskLevel: contract.riskLevel,
    source: contract.source,
    successCriteria: contract.successCriteria,
    requiredEvidence: contract.requiredEvidence,
    stopCondition: contract.stopCondition
  };
}

