import type { Plan, PlanStep, RiskLevel } from "../../schemas/plan.js";
import type { ObjectiveContractV1 } from "./objectiveContract.js";

export function contractToPlan(contract: ObjectiveContractV1): Plan {
  return {
    goal: contract.goal,
    taskType: contract.taskType,
    riskLevel: contract.riskLevel,
    workflowKind: contract.workflowKind,
    requiresPatchWorkflow: contract.workflowKind !== "read_only" && contract.workflowKind !== "advisory" && contract.workflowKind !== "ask_user",
    constraints: [
      ...contract.forbiddenActions.map((action) => `Forbidden action: ${action}`),
      ...contract.requiredEvidence.map((evidence) => `Required evidence: ${evidence}`)
    ],
    allowedPhases: contract.allowedPhases,
    acceptanceCriteria: contract.successCriteria,
    steps: stepsFromContract(contract),
    verificationCommands: contract.verificationRubric.requiredCommands,
    debateRecommended: contract.riskLevel === "high" || contract.reasoningSensitivity === "high",
    reasonForDebate: contract.riskLevel === "high" ? "Objective contract marks the task high risk." : undefined
  };
}

export function overlayPlanWithContract(plan: Plan, contract: ObjectiveContractV1): Plan {
  const contractPlan = contractToPlan(contract);
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
    steps: mergePlanSteps(contractPlan.steps, plan.steps),
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

function stepsFromContract(contract: ObjectiveContractV1): PlanStep[] {
  const patchLike = contract.workflowKind === "patch" || contract.workflowKind === "vision_patch" || contract.workflowKind === "repair";
  const steps: PlanStep[] = [
    step("contract", "Verify objective contract", "Confirm success criteria, evidence, permissions, and stop conditions.", "done"),
    step("plan", "Plan from contract", "Derive role and tool routing from the objective contract.", "pending"),
    step("evidence", "Bind required evidence", `Required evidence: ${contract.requiredEvidence.join(", ")}`, "pending")
  ];
  if (patchLike) {
    steps.push(
      step("implement", "Produce patch candidate", "Generate a narrow candidate that satisfies the contract.", "pending"),
      step("review", "Review and judge", "Review candidates and select only evidence-backed work.", "pending"),
      step("verify", "Verify outcome", contract.verificationRubric.requiredCommands.join("; ") || "Record verifier result.", "pending")
    );
  } else {
    steps.push(step("answer", "Produce read-only deliverable", "Return a bounded answer or artifact summary without mutation.", "pending"));
  }
  return steps;
}

function step(id: string, title: string, detail: string, status: PlanStep["status"]): PlanStep {
  return { id, title, detail, status };
}

function mergePlanSteps(contractSteps: PlanStep[], planSteps: PlanStep[]): PlanStep[] {
  const seen = new Set<string>();
  return [...contractSteps, ...planSteps].filter((stepItem) => {
    const key = stepItem.id || stepItem.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function mergeStrings(primary: string[], secondary: string[]): string[] {
  return [...new Set([...primary, ...secondary].map((item) => item.trim()).filter(Boolean))];
}

function strongerRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return rank[b] >= rank[a] ? b : a;
}
