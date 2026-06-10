import type { ObjectiveTraceV1 } from "./objectiveTrace.js";

export function summarizeObjectiveTrace(trace: ObjectiveTraceV1): string {
  return [
    `${trace.traceId}: ${trace.scenarioProfile.scenarioType}/${trace.planSummary.workflowKind}`,
    `status=${trace.outcome.finalStatus}`,
    `evidence=${trace.evidenceSummary.evidenceScore}`,
    `tools=${trace.toolUsage?.length ?? 0}`,
    trace.outcome.lessons.length ? `lessons=${trace.outcome.lessons.slice(0, 3).join(" | ")}` : "lessons=-"
  ].join(" ");
}
