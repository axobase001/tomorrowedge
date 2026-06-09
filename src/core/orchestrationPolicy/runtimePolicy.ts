import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { RiskLevel } from "../../schemas/plan.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { ContractVerificationResult } from "../contracts/objectiveContract.js";
import type { OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

export type ContractTool = "shell" | "patch_apply" | "file_write";

export type ContractToolGate = {
  allowed: boolean;
  reason: string;
};

export function contractVerificationBlocksExecution(verification: ContractVerificationResult | undefined): boolean {
  return verification?.status === "failed";
}

export function applyPolicyToContract(contract: ObjectiveContractV1, policy: OrchestrationPolicyGenome): ObjectiveContractV1 {
  const next: ObjectiveContractV1 = structuredClone(contract);
  const patchLike = isPatchWorkflow(next.workflowKind);
  const strict = policy.contractPolicy.contractDepth === "strict" || policy.verificationPolicy.verificationStrictness === "strict";
  const light = policy.contractPolicy.contractDepth === "light" && policy.verificationPolicy.verificationStrictness === "light";

  next.successCriteria = tuneSuccessCriteria(next.successCriteria, policy, patchLike);
  next.failureCriteria = tuneFailureCriteria(next.failureCriteria, policy, patchLike);
  next.requiredEvidence = tuneRequiredEvidence(next.requiredEvidence, policy, patchLike);
  next.verificationRubric = {
    ...next.verificationRubric,
    requiredArtifacts: tuneRequiredArtifacts(next.verificationRubric.requiredArtifacts, policy, patchLike),
    evidenceChecks: tuneEvidenceChecks(next.verificationRubric.evidenceChecks, policy),
    reviewerChecks: tuneReviewerChecks(next.verificationRubric.reviewerChecks, policy, next.riskLevel, patchLike),
    judgeChecks: tuneJudgeChecks(next.verificationRubric.judgeChecks, policy, next.riskLevel, patchLike)
  };

  if (policy.verificationPolicy.requireCommandValidationForPatch && patchLike && !next.verificationRubric.requiredCommands.length) {
    next.verificationRubric.requiredCommands.push("npm test");
  }
  if (light && !policy.verificationPolicy.requireCommandValidationForPatch && patchLike) {
    next.verificationRubric.requiredCommands = next.verificationRubric.requiredCommands.slice(0, 1);
  }

  next.stopCondition = tuneStopCondition(next.stopCondition, policy, strict);
  next.budget = {
    ...next.budget,
    maxSteps: Math.min(next.budget.maxSteps, planStepLimit(policy)),
    maxRepairRounds: Math.max(0, Math.min(next.budget.maxRepairRounds, policy.repairPolicy.maxRepairRounds))
  };

  if (policy.verificationPolicy.requireReviewerForHighRisk && next.riskLevel === "high") {
    for (const role of ["reviewer", "judge"] as AgentRole[]) {
      if (!next.allowedRoles.includes(role)) next.allowedRoles.push(role);
    }
  }
  if (shouldPolicyRequireReviewer(policy, next.riskLevel, patchLike) && !next.allowedRoles.includes("reviewer")) {
    next.allowedRoles.push("reviewer");
  }
  if (shouldPolicyRequireJudge(policy, next.riskLevel, patchLike) && !next.allowedRoles.includes("judge")) {
    next.allowedRoles.push("judge");
  }

  next.confidence = Math.max(0.1, Math.min(1, next.confidence + (strict ? 0.03 : light ? -0.03 : 0)));
  return next;
}

export function planStepLimit(policy: OrchestrationPolicyGenome): number {
  if (policy.planningPolicy.maxStepsMode === "conservative") return 6;
  if (policy.planningPolicy.maxStepsMode === "aggressive") return 16;
  return 12;
}

export function traceCompletenessThreshold(policy?: OrchestrationPolicyGenome): number {
  if (!policy) return 70;
  if (policy.verificationPolicy.verificationStrictness === "strict" || policy.stopPolicy.stopMode === "evidence_strict") return 90;
  if (policy.verificationPolicy.verificationStrictness === "light" || policy.stopPolicy.stopMode === "early") return 60;
  return 75;
}

export function requiredEvidenceThreshold(policy?: OrchestrationPolicyGenome): number {
  if (!policy) return 0.75;
  if (policy.verificationPolicy.verificationStrictness === "strict") return 1;
  if (policy.verificationPolicy.verificationStrictness === "light") return 0.5;
  return 0.75;
}

export function shouldPolicyRequireReviewer(policy: OrchestrationPolicyGenome | undefined, riskLevel: RiskLevel, patchLike = true): boolean {
  if (!policy || !patchLike) return riskLevel === "high";
  return riskMeetsThreshold(riskLevel, policy.routingPolicy.reviewerThreshold);
}

export function shouldPolicyRequireJudge(policy: OrchestrationPolicyGenome | undefined, riskLevel: RiskLevel, patchLike = true): boolean {
  if (!policy || !patchLike) return riskLevel === "high";
  return riskMeetsThreshold(riskLevel, policy.routingPolicy.judgeThreshold);
}

export function policyBudgetEstimate(estimatedCostUsd: number | undefined, policy: OrchestrationPolicyGenome | undefined, role: AgentRole): number | undefined {
  if (estimatedCostUsd === undefined || !policy) return estimatedCostUsd;
  const decisionRole = role === "core" || role === "planner" || role === "reviewer" || role === "judge";
  if (!decisionRole) return policy.routingPolicy.routingPreference === "cheap" ? estimatedCostUsd * 0.8 : estimatedCostUsd;
  if (policy.routingPolicy.routingPreference === "quality") return estimatedCostUsd * 0.75;
  if (policy.routingPolicy.routingPreference === "cheap") return estimatedCostUsd * 1.35;
  if (policy.routingPolicy.routingPreference === "privacy") return estimatedCostUsd * 1.1;
  return estimatedCostUsd;
}

export function policyEscalationSignals(policy: OrchestrationPolicyGenome | undefined, riskLevel: RiskLevel | undefined, existing: string[]): string[] {
  const signals = new Set(existing);
  if (!policy) return [...signals];
  if (riskLevel === "high") signals.add("high_risk_patch");
  if (policy.routingPolicy.routingPreference === "quality" && (riskLevel === "medium" || riskLevel === "high")) signals.add("reviewer_disagreement");
  if (policy.stopPolicy.escalateWhenAmbiguous) signals.add("reviewer_disagreement");
  return [...signals];
}

export function contractToolGate(contract: ObjectiveContractV1 | undefined, tool: ContractTool): ContractToolGate {
  if (!contract) return { allowed: true, reason: "No objective contract is active." };
  const forbiddenActions = forbiddenActionsForTool(tool);
  const forbidden = forbiddenActions.find((action) => contract.forbiddenActions.includes(action));
  if (forbidden) {
    return {
      allowed: false,
      reason: `Objective contract forbids ${forbidden}; ${tool} is blocked.`
    };
  }
  const requiredTool = tool === "file_write" ? "patch_apply" : tool;
  if (!contract.allowedTools.includes(requiredTool)) {
    return {
      allowed: false,
      reason: `Objective contract does not allow tool ${requiredTool}; ${tool} is blocked.`
    };
  }
  return { allowed: true, reason: `Objective contract allows ${tool}.` };
}

export function contractPhaseAllowed(contract: ObjectiveContractV1 | undefined, phase: EventPhase): boolean {
  return !contract || contract.allowedPhases.includes(phase);
}

export function contractRoleAllowed(contract: ObjectiveContractV1 | undefined, role: AgentRole): boolean {
  return !contract || contract.allowedRoles.includes(role);
}

export function effectiveMaxShellRuns(config: TomorrowEdgeConfig, contract?: ObjectiveContractV1): number {
  return Math.max(0, Math.min(config.autonomy.max_shell_runs, contract?.budget.maxShellRuns ?? config.autonomy.max_shell_runs));
}

export function effectiveMaxRepairRounds(config: TomorrowEdgeConfig, contract?: ObjectiveContractV1, policy?: OrchestrationPolicyGenome): number {
  return Math.max(0, Math.min(
    config.autonomy.max_repairs,
    contract?.budget.maxRepairRounds ?? config.autonomy.max_repairs,
    policy?.repairPolicy.maxRepairRounds ?? config.autonomy.max_repairs
  ));
}

export function shouldRetryFailedVerification(policy?: OrchestrationPolicyGenome): boolean {
  return policy?.repairPolicy.retryOnFailedVerification !== false;
}

export function shouldRetryMissingEvidence(policy?: OrchestrationPolicyGenome): boolean {
  return policy?.repairPolicy.retryOnMissingEvidence !== false;
}

export function shouldStopOnRecurringFailure(policy?: OrchestrationPolicyGenome): boolean {
  return policy?.repairPolicy.stopOnRecurringFailure !== false;
}

export function policyAllowsPartialCompletion(policy?: OrchestrationPolicyGenome): boolean {
  return policy?.stopPolicy.allowPartialCompletion !== false;
}

export function policyStopMode(policy?: OrchestrationPolicyGenome): OrchestrationPolicyGenome["stopPolicy"]["stopMode"] {
  return policy?.stopPolicy.stopMode ?? "balanced";
}

export function policyRouteTag(policy: OrchestrationPolicyGenome | undefined): string {
  return policy ? `policy:${policy.routingPolicy.routingPreference}` : "policy:default";
}

function tuneSuccessCriteria(criteria: string[], policy: OrchestrationPolicyGenome, patchLike: boolean): string[] {
  const next = unique(criteria).slice(0, Math.max(1, policy.contractPolicy.successCriteriaCount));
  if (policy.contractPolicy.contractDepth === "strict") {
    next.push("Every required evidence item is linked in the event ledger before final delivery.");
    next.push("The workflow stop reason is explicit and consistent with the objective-action-feedback trace.");
    if (patchLike) next.push("Reviewer and judge decisions block unresolved correctness, safety, or verification risk.");
  }
  if (policy.contractPolicy.contractDepth === "light") {
    return unique(next).slice(0, Math.max(1, Math.min(2, policy.contractPolicy.successCriteriaCount)));
  }
  return unique(next);
}

function tuneFailureCriteria(criteria: string[], policy: OrchestrationPolicyGenome, patchLike: boolean): string[] {
  if (!policy.contractPolicy.requireFailureCriteria) return unique(criteria).slice(0, 1);
  const next = unique(criteria);
  if (policy.contractPolicy.contractDepth === "strict") {
    next.push("Trace completeness is below the policy threshold.");
    next.push("The selected action violates allowedTools, allowedPhases, allowedRoles, or forbiddenActions.");
    if (patchLike) next.push("Patch execution proceeds after failed contract verification.");
  }
  return unique(next);
}

function tuneRequiredEvidence(evidence: string[], policy: OrchestrationPolicyGenome, patchLike: boolean): string[] {
  const safetyEvidence = evidence.filter((item) => /contract|summary|patch diff|review decision|judge decision/i.test(item));
  if (!policy.contractPolicy.requireEvidence) return unique(safetyEvidence.length ? safetyEvidence : evidence.slice(0, 2));
  const next = new Set(evidence);
  if (policy.verificationPolicy.requireEvidencePacket) next.add("evidence packet");
  if (policy.contractPolicy.contractDepth === "strict" || policy.verificationPolicy.verificationStrictness === "strict") {
    next.add("objective-action-feedback trace");
    next.add("trace completeness");
    next.add("workflow stop reason");
    if (patchLike) next.add("artifact projection");
  }
  return [...next];
}

function tuneRequiredArtifacts(artifacts: string[], policy: OrchestrationPolicyGenome, patchLike: boolean): string[] {
  if (policy.verificationPolicy.verificationStrictness === "light") return unique(artifacts).slice(0, patchLike ? 2 : 1);
  const next = new Set(artifacts);
  if (policy.verificationPolicy.requireEvidencePacket) next.add("evidence_packet");
  if (policy.verificationPolicy.verificationStrictness === "strict") {
    next.add("trace_completeness");
    next.add("workflow_stop_reason");
    if (patchLike) next.add("artifact_projection");
  }
  return [...next];
}

function tuneEvidenceChecks(checks: string[], policy: OrchestrationPolicyGenome): string[] {
  const next = [...checks];
  if (policy.verificationPolicy.verificationStrictness === "strict") {
    next.push("Verify that required evidence has explicit event or artifact references.");
    next.push("Verify that the trace completeness threshold is met.");
  }
  return unique(next);
}

function tuneReviewerChecks(checks: string[], policy: OrchestrationPolicyGenome, riskLevel: RiskLevel, patchLike: boolean): string[] {
  const next = [...checks];
  if (patchLike && shouldPolicyRequireReviewer(policy, riskLevel, patchLike)) {
    next.push(`Reviewer escalation required by reviewerThreshold=${policy.routingPolicy.reviewerThreshold}.`);
  }
  if (policy.verificationPolicy.verificationStrictness === "strict") {
    next.push("Reviewer must reject missing evidence or forbidden tool use.");
  }
  return unique(next);
}

function tuneJudgeChecks(checks: string[], policy: OrchestrationPolicyGenome, riskLevel: RiskLevel, patchLike: boolean): string[] {
  const next = [...checks];
  if (patchLike && shouldPolicyRequireJudge(policy, riskLevel, patchLike)) {
    next.push(`Judge escalation required by judgeThreshold=${policy.routingPolicy.judgeThreshold}.`);
  }
  if (policy.stopPolicy.stopMode === "evidence_strict") {
    next.push("Judge must block completion unless required evidence and stop reason are present.");
  }
  return unique(next);
}

function tuneStopCondition(stopCondition: ObjectiveContractV1["stopCondition"], policy: OrchestrationPolicyGenome, strict: boolean): ObjectiveContractV1["stopCondition"] {
  const next = structuredClone(stopCondition);
  if (policy.stopPolicy.stopMode === "early") {
    next.partial = unique([...next.partial, "Stop early with partial completion when the policy allows partial completion and evidence is bounded."]);
  }
  if (strict || policy.stopPolicy.stopMode === "evidence_strict") {
    next.success = unique([...next.success, "Trace completeness and required evidence meet the policy threshold."]);
    next.unsafe = unique([...next.unsafe, "Any attempted forbidden tool/action stops execution before mutation."]);
    next.failure = unique([...next.failure, "Contract verification failed before execution."]);
  }
  if (policy.stopPolicy.escalateWhenAmbiguous) {
    next.partial = unique([...next.partial, "Ambiguous completion is escalated to reviewer/judge or user-visible advisory."]);
  }
  return next;
}

function forbiddenActionsForTool(tool: ContractTool): string[] {
  if (tool === "shell") return ["run_shell"];
  if (tool === "file_write") return ["write_files", "apply_patch"];
  return ["apply_patch"];
}

function isPatchWorkflow(workflowKind: ObjectiveContractV1["workflowKind"]): boolean {
  return workflowKind === "patch" || workflowKind === "vision_patch" || workflowKind === "repair";
}

function riskMeetsThreshold(riskLevel: RiskLevel, threshold: "low" | "medium" | "high"): boolean {
  const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  const thresholdRank = threshold === "low" ? 0 : threshold === "medium" ? 1 : 2;
  return rank[riskLevel] >= thresholdRank;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}
