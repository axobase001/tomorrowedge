import type { AccessMode } from "../../config/schema.js";
import type { WorkflowIntentDecision } from "../goal/workflowIntent.js";
import type { ScenarioProfile } from "./scenarioTypes.js";

export type ScenarioProfilerInput = {
  goal: string;
  workflowIntent: WorkflowIntentDecision;
  accessMode: AccessMode;
  hasImageInputs?: boolean;
};

export function profileScenario(input: ScenarioProfilerInput): ScenarioProfile {
  return {
    scenarioType: "unknown",
    userIntent: "Legacy scenarioProfiler no longer performs local semantic classification.",
    expectedDeliverable: input.workflowIntent.requiresPatchWorkflow ? "model-routed patch workflow result" : "model-routed read-only result",
    ambiguityLevel: "high",
    likelyWorkflowKind: input.workflowIntent.workflowKind,
    riskSignals: input.accessMode === "full" ? ["full_access"] : [],
    evidenceNeeds: input.workflowIntent.requiresPatchWorkflow
      ? ["model scenario profile", "event ledger", "patch diff", "review decision", "judge decision"]
      : ["model scenario profile", "event ledger", "inspected context"],
    suggestedRoles: input.workflowIntent.requiresPatchWorkflow
      ? ["planner", "explorer", "coder_a", "reviewer", "judge", "runner", "summarizer"]
      : ["planner", "explorer", "summarizer"]
  };
}
