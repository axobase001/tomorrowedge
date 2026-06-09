import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import type { Plan } from "../../schemas/plan.js";
import { inferWorkflowKindFromEvents, type WorkflowKind } from "../orchestration/workflowKind.js";

export type TraceCompleteness = {
  score: number;
  missing: string[];
};

type TraceRequirement = { label: string; types: TomorrowEdgeEvent["type"][] };

const PATCH_REQUIRED: TraceRequirement[] = [
  { label: "plan recorded", types: ["evidence_update"] },
  { label: "context recorded", types: ["context_select"] },
  { label: "candidate patch recorded", types: ["patch_candidate"] },
  { label: "review recorded", types: ["review_decision"] },
  { label: "judge decision recorded", types: ["judge_decision"] },
  { label: "patch apply recorded", types: ["patch_apply"] },
  { label: "shell run recorded", types: ["shell_run"] },
  { label: "cost recorded", types: ["cost_usage", "budget_decision"] },
  { label: "artifacts linked", types: ["artifact_projection"] },
  { label: "stop reason recorded", types: ["workflow_stop_reason"] }
];

const READ_ONLY_REQUIRED: TraceRequirement[] = [
  { label: "access mode recorded", types: ["access_mode"] },
  { label: "conversation recorded", types: ["conversation_message"] },
  { label: "workflow intent recorded", types: ["workflow_intent"] },
  { label: "plan recorded", types: ["evidence_update"] },
  { label: "context recorded", types: ["context_select"] },
  { label: "summary recorded", types: ["summary"] },
  { label: "stop reason recorded", types: ["workflow_stop_reason"] },
  { label: "cost or budget recorded", types: ["cost_usage", "budget_preview", "budget_decision"] }
];

const ADVISORY_REQUIRED: TraceRequirement[] = [
  { label: "access mode recorded", types: ["access_mode"] },
  { label: "conversation recorded", types: ["conversation_message"] },
  { label: "workflow intent recorded", types: ["workflow_intent"] },
  { label: "plan recorded", types: ["evidence_update"] },
  { label: "context recorded", types: ["context_select"] },
  { label: "summary recorded", types: ["summary"] },
  { label: "stop reason recorded", types: ["workflow_stop_reason"] }
];

export function computeTraceCompleteness(events: TomorrowEdgeEvent[], options: { workflowKind?: WorkflowKind; plan?: Plan } = {}): TraceCompleteness {
  const workflowKind = options.workflowKind ?? inferWorkflowKindFromEvents(events, options.plan);
  const required = requirementsForWorkflowKind(workflowKind);
  const presentTypes = new Set(events.map((event) => event.type));
  const missing = required.filter((item) => !item.types.some((type) => presentTypes.has(type))).map((item) => item.label);
  return {
    score: Math.round(((required.length - missing.length) / required.length) * 100),
    missing
  };
}

function requirementsForWorkflowKind(workflowKind: WorkflowKind): TraceRequirement[] {
  if (workflowKind === "read_only") return READ_ONLY_REQUIRED;
  if (workflowKind === "advisory" || workflowKind === "ask_user") return ADVISORY_REQUIRED;
  return PATCH_REQUIRED;
}
