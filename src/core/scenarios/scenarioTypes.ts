import type { AgentRole } from "../../schemas/agentTask.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";

export type ScenarioType =
  | "coding"
  | "research"
  | "document"
  | "debugging"
  | "refactor"
  | "analysis"
  | "planning"
  | "ops"
  | "unknown";

export type ScenarioProfile = {
  scenarioType: ScenarioType;
  userIntent: string;
  expectedDeliverable: string;
  ambiguityLevel: "low" | "medium" | "high";
  likelyWorkflowKind: WorkflowKind;
  riskSignals: string[];
  evidenceNeeds: string[];
  suggestedRoles: AgentRole[];
};

