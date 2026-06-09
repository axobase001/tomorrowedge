import type { ObjectiveTraceV1 } from "./objectiveTrace.js";

export function traceIndexKey(trace: ObjectiveTraceV1): string {
  return [trace.scenarioProfile.scenarioType, trace.scenarioProfile.likelyWorkflowKind, trace.contract.taskType, trace.contract.riskLevel].join(":");
}

