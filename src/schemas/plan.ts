import type { EventPhase } from "../core/events/eventTypes.js";
import type { WorkflowKind } from "../core/orchestration/workflowKind.js";
import type { TaskGraph } from "../core/planning/taskGraph.js";

export type RiskLevel = "low" | "medium" | "high";
export type TaskType = "bugfix" | "feature" | "refactor" | "test" | "docs" | "analysis" | "unknown";

export type PlanStep = {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "running" | "done" | "blocked";
};

export type Plan = {
  goal: string;
  constraints: string[];
  riskLevel: RiskLevel;
  taskType: TaskType;
  workflowKind?: WorkflowKind;
  requiresPatchWorkflow?: boolean;
  allowedPhases?: EventPhase[];
  acceptanceCriteria?: string[];
  steps: PlanStep[];
  taskGraph?: TaskGraph;
  expectedFiles?: string[];
  verificationCommands?: string[];
  debateRecommended: boolean;
  reasonForDebate?: string;
};
