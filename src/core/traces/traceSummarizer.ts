import type { ObjectiveTraceV1 } from "./objectiveTrace.js";

export function summarizeObjectiveTrace(trace: ObjectiveTraceV1): string {
  return [
    `${trace.traceId}: ${trace.scenarioProfile.scenarioType}/${trace.planSummary.workflowKind}`,
    `status=${trace.outcome.finalStatus}`,
    `evidence=${trace.evidenceSummary.evidenceScore}`,
    trace.outcome.lessons.length ? `lessons=${trace.outcome.lessons.slice(0, 3).join(" | ")}` : "lessons=-"
  ].join(" ");
}

