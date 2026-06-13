import type { Plan } from "../../schemas/plan.js";
import type { TomorrowEdgeEvent } from "../events/eventTypes.js";

export type WorkflowKind =
  | "read_only"
  | "patch"
  | "repair"
  | "vision_patch"
  | "advisory"
  | "ask_user"
  | "sirius_council";

export function workflowKindFromPlan(plan?: Pick<Plan, "workflowKind" | "requiresPatchWorkflow" | "taskType">): WorkflowKind {
  if (plan?.workflowKind) return plan.workflowKind;
  if (plan?.requiresPatchWorkflow === false || plan?.taskType === "analysis") return "read_only";
  return "patch";
}

export function inferWorkflowKindFromEvents(events: TomorrowEdgeEvent[], plan?: Pick<Plan, "workflowKind" | "requiresPatchWorkflow" | "taskType">): WorkflowKind {
  if (events.some((event) => event.type === "council_session_started" || event.type === "chief_final_review")) return "sirius_council";
  if (plan?.workflowKind) return plan.workflowKind;
  const types = new Set(events.map((event) => event.type));
  if (types.has("patch_candidate") || types.has("patch_apply") || types.has("review_decision") || types.has("judge_decision")) return "patch";
  const intent = events.find((event) => event.type === "workflow_intent");
  if (intent?.type === "workflow_intent" && !intent.requiresPatchWorkflow) return "read_only";
  return workflowKindFromPlan(plan);
}
