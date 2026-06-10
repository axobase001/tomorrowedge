import type { AgentRole } from "../../schemas/agentTask.js";
import type { EventPhase, TomorrowEdgeEvent } from "../events/eventTypes.js";
import type { AgentGraphState } from "../agentGraph/state.js";
import { computeTraceCompleteness } from "../diagnostics/traceCompleteness.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";
import { addTrace } from "./traceStore.js";
import type { ObjectiveTraceV1 } from "./objectiveTrace.js";
import { makeId } from "../../utils/ids.js";

export async function finalizePostApprovalTrace(cwd: string, state: AgentGraphState, source: "browser_cockpit" | "tui"): Promise<AgentGraphState> {
  const stopReason = buildStopReason(state, source);
  const stopEvent = makeEvent(state, {
    type: "workflow_stop_reason",
    phase: "summary",
    role: "summarizer",
    reason: stopReason.reason,
    result: stopReason.result
  });
  const eventsWithStop = [...state.events, stopEvent];
  const workflowKind = resolveWorkflowKind(state);
  const completeness = computeTraceCompleteness(eventsWithStop, { workflowKind, plan: state.plan });
  const completenessEvent = makeEvent(state, {
    type: "trace_completeness",
    phase: "summary",
    role: "summarizer",
    score: completeness.score,
    missing: completeness.missing,
    workflowKind
  });
  const next = {
    ...state,
    traceCompleteness: completeness,
    events: [...eventsWithStop, completenessEvent]
  };
  const trace = buildPostApprovalObjectiveTrace(next, workflowKind);
  if (!trace) return next;
  const traceRef = writeArtifact(next, "objective_traces", JSON.stringify(trace, null, 2), "json");
  const traced = {
    ...next,
    objectiveTrace: trace,
    events: [
      ...next.events,
      makeEvent(next, {
        type: "objective_trace_written",
        phase: "summary",
        role: "summarizer",
        traceId: trace.traceId,
        traceRef,
        outcomeStatus: trace.outcome.finalStatus,
        evidenceScore: trace.evidenceSummary.evidenceScore
      })
    ]
  };
  await addTrace(cwd, trace);
  return traced;
}

function buildStopReason(state: AgentGraphState, source: string): { reason: string; result: string } {
  const result = state.finalSummary?.result ?? (state.runResults.some((run) => run.success) ? "completed" : "partially_completed");
  if (result === "completed") {
    return { result, reason: `post-approval ${source} workflow completed with ${state.changedFiles.length} changed file(s) and ${state.runResults.length} shell run(s).` };
  }
  if (result === "failed") return { result, reason: `post-approval ${source} workflow failed after user-authorized action.` };
  if (result === "aborted") return { result, reason: `post-approval ${source} workflow was aborted by user decision.` };
  return { result, reason: `post-approval ${source} workflow ended partially completed.` };
}

function buildPostApprovalObjectiveTrace(state: AgentGraphState, workflowKind: WorkflowKind): ObjectiveTraceV1 | undefined {
  if (!state.objectiveContract || !state.contractVerification) return undefined;
  const finalStatus = finalTraceStatus(state);
  const missingEvidence = state.traceCompleteness?.missing ?? [];
  const passedRuns = state.runResults.filter((run) => run.success);
  const failedRuns = state.runResults.filter((run) => !run.success);
  return {
    schemaVersion: "objective-trace/v1",
    traceId: makeId("trace"),
    runId: state.sessionId,
    createdAt: new Date().toISOString(),
    goal: state.goal,
    scenarioProfile: state.scenarioProfile ?? {
      scenarioType: "unknown",
      userIntent: state.goal,
      expectedDeliverable: state.finalSummary?.changedFiles.length ? "changed files" : "workflow result",
      ambiguityLevel: "medium",
      likelyWorkflowKind: workflowKind,
      riskSignals: [],
      evidenceNeeds: state.objectiveContract.requiredEvidence,
      suggestedRoles: []
    },
    policySummary: state.objectiveTrace?.policySummary,
    contract: state.objectiveContract,
    contractVerification: state.contractVerification,
    planSummary: {
      workflowKind,
      steps: state.plan?.steps.map((step) => step.title) ?? [],
      allowedPhases: state.plan?.allowedPhases ?? [],
      verificationCommands: state.plan?.verificationCommands ?? []
    },
    roleGraphSummary: {
      rolesUsed: uniqueRoles(state.agents.map((agent) => agent.role)),
      routingDecisions: state.events.filter((event) => event.type === "routing_decision").map((event) => `${event.assignedRole} -> ${event.assignedProvider}/${event.assignedModel}`),
      fallbackDecisions: state.events.filter((event) => event.type === "fallback_to_native").map((event) => `${event.fallbackRole}: ${event.reason}`)
    },
    executionSummary: {
      actions: state.events.map((event) => event.type),
      toolCalls: state.events.filter((event) => event.type === "shell_run").map((event) => event.command),
      observations: state.events.filter((event) => event.type === "outcome_observation").map((event) => event.summary),
      shellRuns: state.runResults.length,
      filesTouched: state.changedFiles
    },
    evidenceSummary: {
      evidencePacketRefs: state.evidencePackets.flatMap((packet) => packet.supportingArtifacts),
      requiredEvidenceSatisfied: state.objectiveContract.requiredEvidence.filter((item) => !missingEvidence.some((missing) => item.toLowerCase().includes(missing.toLowerCase()))),
      missingEvidence,
      evidenceScore: state.traceCompleteness?.score ?? 0
    },
    verificationSummary: {
      status: finalStatus === "success" ? "success" : finalStatus === "failure" ? "failure" : finalStatus === "unsafe" ? "unsafe" : "partial",
      passedCriteria: passedRuns.map((run) => run.command),
      failedCriteria: failedRuns.map((run) => `${run.command} exit=${run.exitCode}`),
      reviewerDecision: state.review?.overallRecommendation,
      judgeDecision: state.judge?.decision
    },
    repairSummary: {
      repairAttempts: state.repairCandidates.length,
      recovered: state.repairCandidates.length > 0 && passedRuns.length > 0
    },
    costSummary: {
      tokens: state.usageSummary.totalTokens,
      toolCalls: state.events.filter((event) => event.type === "model_call" || event.type === "shell_run" || event.type === "patch_apply").length,
      shellRuns: state.runResults.length,
      estimatedCostUsd: state.usageSummary.estimatedCostUsd
    },
    feedback: {
      implicitSignals: ["user_approved_action"]
    },
    traceCompleteness: state.traceCompleteness,
    outcome: {
      finalStatus,
      failureType: finalStatus === "failure" ? "post_approval_verification_failed" : undefined,
      lessons: state.finalSummary?.risksRemaining ?? []
    }
  };
}

function finalTraceStatus(state: AgentGraphState): ObjectiveTraceV1["outcome"]["finalStatus"] {
  if (state.finalSummary?.result === "completed") return "success";
  if (state.finalSummary?.result === "failed") return "failure";
  if (state.finalSummary?.result === "aborted") return "aborted";
  if (state.contractVerification?.status === "failed") return "unsafe";
  return "partial";
}

function resolveWorkflowKind(state: AgentGraphState): WorkflowKind {
  return state.workflowKind ?? state.objectiveContract?.workflowKind ?? state.plan?.workflowKind ?? "patch";
}

function uniqueRoles(values: AgentRole[]): AgentRole[] {
  return [...new Set(values)];
}

function writeArtifact(state: AgentGraphState, kind: string, content: string, extension: string): string {
  const ref = `artifacts/${kind}/${makeId(kind)}.${extension}`;
  state.eventArtifacts.push({ ref, content });
  return ref;
}

function makeEvent(state: AgentGraphState, event: Record<string, unknown>): TomorrowEdgeEvent {
  return {
    ...event,
    id: makeId(String(event.type ?? "event")),
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId,
    mode: state.access.mode
  } as TomorrowEdgeEvent;
}
