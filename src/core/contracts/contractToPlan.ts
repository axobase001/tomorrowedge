import type { Plan, PlanStep, RiskLevel } from "../../schemas/plan.js";
import type { OrchestrationPolicyGenome } from "../orchestrationPolicy/orchestrationPolicy.js";
import { planStepLimit, shouldPolicyRequireJudge, shouldPolicyRequireReviewer } from "../orchestrationPolicy/runtimePolicy.js";
import type { ObjectiveContractV1 } from "./objectiveContract.js";

export function contractToPlan(contract: ObjectiveContractV1, policy?: OrchestrationPolicyGenome): Plan {
  const patchLike = contract.workflowKind !== "read_only" && contract.workflowKind !== "advisory" && contract.workflowKind !== "ask_user";
  return {
    goal: contract.goal,
    taskType: contract.taskType,
    riskLevel: contract.riskLevel,
    workflowKind: contract.workflowKind,
    requiresPatchWorkflow: patchLike,
    constraints: [
      ...contract.forbiddenActions.map((action) => `Forbidden action: ${action}`),
      ...contract.requiredEvidence.map((evidence) => `Required evidence: ${evidence}`)
    ],
    allowedPhases: contract.allowedPhases,
    acceptanceCriteria: contract.successCriteria,
    steps: stepsFromContract(contract, policy),
    verificationCommands: contract.verificationRubric.requiredCommands,
    debateRecommended: contract.riskLevel === "high"
      || contract.reasoningSensitivity === "high"
      || shouldPolicyRequireReviewer(policy, contract.riskLevel, patchLike)
      || shouldPolicyRequireJudge(policy, contract.riskLevel, patchLike),
    reasonForDebate: debateReason(contract, policy, patchLike)
  };
}

export function overlayPlanWithContract(plan: Plan, contract: ObjectiveContractV1, policy?: OrchestrationPolicyGenome): Plan {
  const contractPlan = contractToPlan(contract, policy);
  const workflowKind = effectiveWorkflowKind(plan, contract);
  return {
    ...plan,
    goal: plan.goal || contract.goal,
    taskType: effectiveTaskType(plan, contract),
    riskLevel: strongerRisk(plan.riskLevel, contract.riskLevel),
    workflowKind,
    requiresPatchWorkflow: isPatchWorkflow(workflowKind),
    allowedPhases: contract.allowedPhases,
    acceptanceCriteria: mergeStrings(contract.successCriteria, plan.acceptanceCriteria ?? []),
    constraints: mergeStrings(contractPlan.constraints, plan.constraints ?? []),
    steps: mergePlanSteps(contractPlan.steps, plan.steps, policy),
    verificationCommands: mergeStrings(contract.verificationRubric.requiredCommands, plan.verificationCommands ?? []),
    debateRecommended: plan.debateRecommended || contractPlan.debateRecommended,
    reasonForDebate: plan.reasonForDebate ?? contractPlan.reasonForDebate
  };
}

function effectiveWorkflowKind(plan: Plan, contract: ObjectiveContractV1): Plan["workflowKind"] {
  if (contract.workflowKind === "read_only" && plan.workflowKind === "advisory") return "advisory";
  return contract.workflowKind;
}

function effectiveTaskType(plan: Plan, contract: ObjectiveContractV1): Plan["taskType"] {
  if (contract.workflowKind === "read_only" || contract.workflowKind === "advisory" || contract.workflowKind === "ask_user") return "analysis";
  return plan.taskType === "unknown" || plan.taskType === "analysis" ? contract.taskType : plan.taskType;
}

function isPatchWorkflow(workflowKind: Plan["workflowKind"]): boolean {
  return workflowKind !== "read_only" && workflowKind !== "advisory" && workflowKind !== "ask_user";
}

function stepsFromContract(contract: ObjectiveContractV1, policy?: OrchestrationPolicyGenome): PlanStep[] {
  const patchLike = contract.workflowKind === "patch" || contract.workflowKind === "vision_patch" || contract.workflowKind === "repair";
  const evidenceDetail = policy?.planningPolicy.requirePlanStepEvidenceBinding === false
    ? undefined
    : ` Evidence binding: ${contract.requiredEvidence.join(", ")}.`;
  const steps: PlanStep[] = [
    step("contract", "Verify objective contract", withEvidenceBinding("Confirm success criteria, evidence, permissions, and stop conditions.", evidenceDetail), "done"),
    step("plan", "Plan from contract", withEvidenceBinding("Derive role and tool routing from the objective contract.", evidenceDetail), "pending")
  ];
  if (policy?.planningPolicy.requirePlanStepEvidenceBinding !== false) {
    steps.push(step("evidence", "Bind required evidence", `Required evidence: ${contract.requiredEvidence.join(", ")}`, "pending"));
  }
  if (patchLike) {
    steps.push(
      step("implement", "Produce patch candidate", withEvidenceBinding("Generate a narrow candidate that satisfies the contract.", evidenceDetail), "pending"),
      step("review", "Review and judge", withEvidenceBinding("Review candidates and select only evidence-backed work.", evidenceDetail), "pending"),
      step("verify", "Verify outcome", withEvidenceBinding(contract.verificationRubric.requiredCommands.join("; ") || "Record verifier result.", evidenceDetail), "pending")
    );
  } else {
    steps.push(step("answer", "Produce read-only deliverable", withEvidenceBinding("Return a bounded answer or artifact summary without mutation.", evidenceDetail), "pending"));
  }
  return steps.slice(0, policy ? planStepLimit(policy) : 12);
}

function step(id: string, title: string, detail: string, status: PlanStep["status"]): PlanStep {
  return { id, title, detail, status };
}

function mergePlanSteps(contractSteps: PlanStep[], planSteps: PlanStep[], policy?: OrchestrationPolicyGenome): PlanStep[] {
  const seen = new Set<string>();
  return [...contractSteps, ...planSteps].filter((stepItem) => {
    const key = stepItem.id || stepItem.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, policy ? planStepLimit(policy) : 12);
}

function mergeStrings(primary: string[], secondary: string[]): string[] {
  return [...new Set([...primary, ...secondary].map((item) => item.trim()).filter(Boolean))];
}

function strongerRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return rank[b] >= rank[a] ? b : a;
}

function withEvidenceBinding(detail: string, evidenceDetail?: string): string {
  return evidenceDetail ? `${detail}${evidenceDetail}` : detail;
}

function debateReason(contract: ObjectiveContractV1, policy: OrchestrationPolicyGenome | undefined, patchLike: boolean): string | undefined {
  if (contract.riskLevel === "high") return "Objective contract marks the task high risk.";
  if (policy && patchLike && shouldPolicyRequireReviewer(policy, contract.riskLevel, patchLike)) {
    return `Policy reviewerThreshold=${policy.routingPolicy.reviewerThreshold} escalates this workflow to review.`;
  }
  if (policy && patchLike && shouldPolicyRequireJudge(policy, contract.riskLevel, patchLike)) {
    return `Policy judgeThreshold=${policy.routingPolicy.judgeThreshold} escalates this workflow to judge.`;
  }
  return contract.reasoningSensitivity === "high" ? "Objective contract marks reasoning sensitivity high." : undefined;
}
