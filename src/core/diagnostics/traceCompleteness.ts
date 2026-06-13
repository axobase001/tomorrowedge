import type { TomorrowEdgeEvent } from "../events/eventTypes.js";
import type { Plan } from "../../schemas/plan.js";
import { inferWorkflowKindFromEvents, type WorkflowKind } from "../orchestration/workflowKind.js";

export type TraceCompleteness = {
  score: number;
  missing: string[];
  intentionallySkipped: string[];
  blockedByApproval: string[];
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

const SIRIUS_COUNCIL_REQUIRED: TraceRequirement[] = [
  { label: "chief agent selected", types: ["chief_agent_selected"] },
  { label: "chief agent decision", types: ["chief_agent_decision"] },
  { label: "chief initial plan", types: ["chief_initial_plan"] },
  { label: "council session started", types: ["council_session_started"] },
  { label: "council move", types: ["council_move"] },
  { label: "council consensus", types: ["council_consensus"] },
  { label: "task ownership assignment", types: ["task_ownership_assignment"] },
  { label: "delegated task result", types: ["delegated_task_result"] },
  { label: "evidence packet", types: ["evidence_packet"] },
  { label: "chief final review", types: ["chief_final_review"] },
  { label: "chief delivery decision", types: ["chief_delivery_approved", "chief_revision_requested"] },
  { label: "artifacts linked", types: ["task_graph", "artifact_projection", "chief_final_review", "council_consensus"] },
  { label: "stop reason recorded", types: ["workflow_stop_reason"] }
];

export function computeTraceCompleteness(events: TomorrowEdgeEvent[], options: { workflowKind?: WorkflowKind; plan?: Plan } = {}): TraceCompleteness {
  const workflowKind = options.workflowKind ?? inferWorkflowKindFromEvents(events, options.plan);
  const required = requirementsForWorkflowKind(workflowKind);
  const presentTypes = new Set(events.map((event) => event.type));
  const rawMissing = required.filter((item) => !item.types.some((type) => presentTypes.has(type))).map((item) => item.label);
  const skipped = classifySkippedRequirements(rawMissing, events, options.plan);
  const missing = rawMissing.filter((item) => !skipped.intentionallySkipped.includes(item) && !skipped.blockedByApproval.includes(item));
  return {
    score: Math.round(((required.length - missing.length) / required.length) * 100),
    missing,
    intentionallySkipped: skipped.intentionallySkipped,
    blockedByApproval: skipped.blockedByApproval
  };
}

function requirementsForWorkflowKind(workflowKind: WorkflowKind): TraceRequirement[] {
  if (workflowKind === "sirius_council") return SIRIUS_COUNCIL_REQUIRED;
  if (workflowKind === "read_only") return READ_ONLY_REQUIRED;
  if (workflowKind === "advisory" || workflowKind === "ask_user") return ADVISORY_REQUIRED;
  return PATCH_REQUIRED;
}

function classifySkippedRequirements(missing: string[], events: TomorrowEdgeEvent[], plan?: Plan): Pick<TraceCompleteness, "intentionallySkipped" | "blockedByApproval"> {
  const intentionallySkipped: string[] = [];
  const blockedByApproval: string[] = [];
  if (missing.includes("shell run recorded")) {
    if (hasApprovalBlockedPatch(events)) {
      blockedByApproval.push("shell run recorded");
    } else if (hasSkippedTestRunner(events) || !plan?.verificationCommands?.length) {
      intentionallySkipped.push("shell run recorded");
    }
  }
  return { intentionallySkipped, blockedByApproval };
}

function hasApprovalBlockedPatch(events: TomorrowEdgeEvent[]): boolean {
  return events.some((event) =>
    event.type === "patch_apply"
    && event.applied === false
    && /approval required/i.test(event.error ?? "")
  ) || events.some((event) =>
    event.type === "role_node_result"
    && event.nodeId === "patch_runner"
    && event.status === "skipped"
    && /approval/i.test(event.summary)
  );
}

function hasSkippedTestRunner(events: TomorrowEdgeEvent[]): boolean {
  return events.some((event) =>
    event.type === "role_node_result"
    && event.nodeId === "test_runner"
    && event.status === "skipped"
  );
}
