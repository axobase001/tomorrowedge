import type { AccessMode, TomorrowEdgeConfig } from "../../config/schema.js";
import { agentRoles, type AgentRole } from "../../schemas/agentTask.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { WorkflowIntentDecision } from "../goal/workflowIntent.js";
import type { ScenarioProfile } from "../scenarios/scenarioTypes.js";
import type { ContractVerificationResult, ObjectiveContractV1 } from "./objectiveContract.js";

export type ContractVerificationInput = {
  accessMode: AccessMode;
  workflowIntent?: Pick<WorkflowIntentDecision, "requiresPatchWorkflow" | "workflowKind">;
  scenarioProfile?: ScenarioProfile;
  config?: TomorrowEdgeConfig;
  baseline?: ObjectiveContractV1;
};

export type ContractVerificationOutput = {
  contract: ObjectiveContractV1;
  verification: ContractVerificationResult;
};

export function verifyAndRepairContract(contract: ObjectiveContractV1, input: ContractVerificationInput): ContractVerificationOutput {
  const next: ObjectiveContractV1 = structuredClone(contract);
  const missing: string[] = [];
  const violations: string[] = [];
  const repairs: string[] = [];

  requireString(next.localObjective, "localObjective", missing);
  requireArray(next.successCriteria, "successCriteria", missing);
  requireArray(next.failureCriteria, "failureCriteria", missing);
  requireArray(next.requiredEvidence, "requiredEvidence", missing);
  if (!hasStopConditions(next)) missing.push("stopCondition");
  repairMissing(next, missing, repairs);

  if (!Number.isFinite(next.budget.maxSteps) || next.budget.maxSteps < 1) {
    next.budget.maxSteps = 3;
    repairs.push("budget.maxSteps repaired to 3");
  }
  if (next.budget.maxRepairRounds < 0) {
    next.budget.maxRepairRounds = 0;
    repairs.push("budget.maxRepairRounds repaired to 0");
  }
  if (next.budget.maxShellRuns < 0) {
    next.budget.maxShellRuns = 0;
    repairs.push("budget.maxShellRuns repaired to 0");
  }

  enforceRoleAndPhaseValidity(next, violations, repairs);
  enforceAccessMode(next, input.accessMode, violations, repairs);
  enforceBaselineBoundary(next, input.baseline, violations, repairs);
  enforceWorkflowIntent(next, input.workflowIntent, violations, repairs);
  enforceHighRiskGovernance(next, repairs);
  enforcePatchVerification(next, repairs);

  const severeViolation = violations.some((item) => item.includes("forbidden action") || item.includes("safety boundary"));
  const downgraded = repairs.some((item) => item.includes("downgraded"));
  const status: ContractVerificationResult["status"] = severeViolation
    ? "failed"
    : downgraded
      ? "downgraded"
      : repairs.length
        ? "repaired"
        : "passed";
  return {
    contract: { ...next, source: repairs.length ? "repaired" : next.source, confidence: Math.max(0.1, Math.min(1, next.confidence - violations.length * 0.1)) },
    verification: {
      status,
      score: scoreContract(next, missing, violations, repairs),
      missing: [...new Set(missing)],
      violations: [...new Set(violations)],
      repairs: [...new Set(repairs)],
      downgradeReason: downgraded ? "Contract exceeded access mode or workflow boundary and was downgraded." : undefined
    }
  };
}

function requireString(value: string | undefined, field: string, missing: string[]): void {
  if (!value || !value.trim()) missing.push(field);
}

function requireArray(value: unknown[] | undefined, field: string, missing: string[]): void {
  if (!Array.isArray(value) || !value.length) missing.push(field);
}

function hasStopConditions(contract: ObjectiveContractV1): boolean {
  return Boolean(contract.stopCondition?.success?.length && contract.stopCondition.partial?.length && contract.stopCondition.failure?.length && contract.stopCondition.unsafe?.length);
}

function repairMissing(contract: ObjectiveContractV1, missing: string[], repairs: string[]): void {
  if (missing.includes("localObjective")) {
    contract.localObjective = `Complete the user goal with auditable evidence: ${contract.goal}`;
    repairs.push("localObjective repaired");
  }
  if (missing.includes("successCriteria")) {
    contract.successCriteria = ["Final output satisfies the local objective.", "Required evidence is present in the event ledger."];
    repairs.push("successCriteria repaired");
  }
  if (missing.includes("failureCriteria")) {
    contract.failureCriteria = ["Required evidence is missing.", "Workflow claims success despite failing verification."];
    repairs.push("failureCriteria repaired");
  }
  if (missing.includes("requiredEvidence")) {
    contract.requiredEvidence = ["objective contract", "contract verification", "final summary"];
    repairs.push("requiredEvidence repaired");
  }
  if (missing.includes("stopCondition")) {
    contract.stopCondition = {
      success: ["Success criteria and required evidence are satisfied."],
      partial: ["Some deliverables exist but evidence or verification is incomplete."],
      failure: ["Required evidence cannot be produced."],
      unsafe: ["Forbidden action or safety boundary violation is detected."]
    };
    repairs.push("stopCondition repaired");
  }
}

function enforceRoleAndPhaseValidity(contract: ObjectiveContractV1, violations: string[], repairs: string[]): void {
  const validRoles = new Set(agentRoles);
  const beforeRoles = contract.allowedRoles.length;
  contract.allowedRoles = contract.allowedRoles.filter((role): role is AgentRole => validRoles.has(role));
  if (contract.allowedRoles.length !== beforeRoles) repairs.push("invalid allowedRoles removed");
  if (!contract.allowedRoles.length) {
    contract.allowedRoles = ["planner", "summarizer"];
    repairs.push("allowedRoles repaired to planner/summarizer");
  }
  const validPhases = new Set<EventPhase>(["planning", "vision", "exploration", "coding", "review", "judge", "patch", "shell", "repair", "verification", "summary", "routing", "memory", "council", "execution", "evolution", "delivery"]);
  const beforePhases = contract.allowedPhases.length;
  contract.allowedPhases = contract.allowedPhases.filter((phase): phase is EventPhase => validPhases.has(phase));
  if (contract.allowedPhases.length !== beforePhases) repairs.push("invalid allowedPhases removed");
  if (!contract.allowedPhases.length) {
    contract.allowedPhases = ["routing", "planning", "summary"];
    repairs.push("allowedPhases repaired to routing/planning/summary");
  }
}

function enforceAccessMode(contract: ObjectiveContractV1, accessMode: AccessMode, violations: string[], repairs: string[]): void {
  if (accessMode !== "restricted") return;
  const mutationTools = new Set(["patch_apply", "shell", "undo"]);
  const removedTools = contract.allowedTools.filter((tool) => mutationTools.has(tool));
  if (removedTools.length) {
    contract.allowedTools = contract.allowedTools.filter((tool) => !mutationTools.has(tool));
    repairs.push(`restricted mode removed tools: ${removedTools.join(", ")}`);
  }
  if (contract.workflowKind !== "read_only" && contract.workflowKind !== "advisory" && contract.workflowKind !== "ask_user") {
    contract.workflowKind = "read_only";
    contract.userScenario.interactionMode = "analysis";
    contract.budget.maxRepairRounds = 0;
    contract.budget.maxShellRuns = 0;
    repairs.push("restricted mode downgraded contract to read_only");
  }
  for (const action of ["write_files", "apply_patch", "run_shell"]) {
    if (!contract.forbiddenActions.includes(action)) contract.forbiddenActions.push(action);
  }
  if (contract.allowedPhases.some((phase) => ["coding", "patch", "shell", "repair"].includes(phase))) {
    contract.allowedPhases = contract.allowedPhases.filter((phase) => !["coding", "patch", "shell", "repair"].includes(phase));
    repairs.push("restricted mode removed mutation phases");
  }
  if (contract.allowedRoles.some((role) => ["coder_a", "coder_b", "runner", "repairer"].includes(role))) {
    contract.allowedRoles = contract.allowedRoles.filter((role) => !["coder_a", "coder_b", "runner", "repairer"].includes(role));
    repairs.push("restricted mode removed mutation roles");
  }
  if (contract.allowedTools.some((tool) => contract.forbiddenActions.includes(tool))) {
    violations.push("forbidden action was present in allowedTools");
  }
}

function enforceBaselineBoundary(contract: ObjectiveContractV1, baseline: ObjectiveContractV1 | undefined, violations: string[], repairs: string[]): void {
  if (!baseline) return;
  for (const action of baseline.forbiddenActions) {
    if (!contract.forbiddenActions.includes(action)) {
      contract.forbiddenActions.push(action);
      repairs.push(`baseline forbidden action restored: ${action}`);
    }
  }
  const baselineToolSet = new Set(baseline.allowedTools);
  const extraTools = contract.allowedTools.filter((tool) => !baselineToolSet.has(tool));
  if (extraTools.length) {
    contract.allowedTools = contract.allowedTools.filter((tool) => baselineToolSet.has(tool));
    repairs.push(`model-added tools removed: ${extraTools.join(", ")}`);
  }
  if (baseline.riskLevel === "high" && contract.riskLevel !== "high") {
    contract.riskLevel = "high";
    repairs.push("baseline high risk restored");
  }
}

function enforceWorkflowIntent(contract: ObjectiveContractV1, workflowIntent: ContractVerificationInput["workflowIntent"], violations: string[], repairs: string[]): void {
  if (!workflowIntent) return;
  if (workflowIntent.requiresPatchWorkflow && contract.workflowKind === "read_only" && !contract.forbiddenActions.includes("apply_patch")) {
    violations.push("workflow_intent requires patch but contract is read_only without access-bound downgrade");
  }
  if (!workflowIntent.requiresPatchWorkflow && (contract.workflowKind === "patch" || contract.workflowKind === "vision_patch" || contract.workflowKind === "repair")) {
    contract.workflowKind = "read_only";
    contract.userScenario.interactionMode = "analysis";
    repairs.push("non-patch workflow intent downgraded contract to read_only");
  }
}

function enforceHighRiskGovernance(contract: ObjectiveContractV1, repairs: string[]): void {
  if (contract.riskLevel !== "high") return;
  for (const role of ["reviewer", "judge"] as AgentRole[]) {
    if (!contract.allowedRoles.includes(role)) {
      contract.allowedRoles.push(role);
      repairs.push(`high-risk contract added ${role}`);
    }
  }
  if (!contract.verificationRubric.reviewerChecks.length) {
    contract.verificationRubric.reviewerChecks.push("Review safety-sensitive or correctness-critical risk.");
    repairs.push("high-risk reviewer checks repaired");
  }
  if (!contract.verificationRubric.judgeChecks.length) {
    contract.verificationRubric.judgeChecks.push("Judge must not accept unresolved high-risk concerns.");
    repairs.push("high-risk judge checks repaired");
  }
}

function enforcePatchVerification(contract: ObjectiveContractV1, repairs: string[]): void {
  const patchLike = contract.workflowKind === "patch" || contract.workflowKind === "vision_patch" || contract.workflowKind === "repair";
  if (!patchLike) return;
  if (!contract.verificationRubric.requiredCommands.length) {
    contract.verificationRubric.requiredCommands.push("npm test");
    repairs.push("patch contract verification command repaired");
  }
  for (const evidence of ["patch diff", "review decision", "judge decision"]) {
    if (!contract.requiredEvidence.includes(evidence)) {
      contract.requiredEvidence.push(evidence);
      repairs.push(`patch evidence repaired: ${evidence}`);
    }
  }
}

function scoreContract(contract: ObjectiveContractV1, missing: string[], violations: string[], repairs: string[]): number {
  let score = 100;
  score -= missing.length * 8;
  score -= violations.length * 18;
  score -= repairs.length * 3;
  if (contract.confidence < 0.6) score -= 8;
  if (!contract.traceHints.similarTraceIds.length) score -= 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}
