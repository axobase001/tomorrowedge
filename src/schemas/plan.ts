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
  steps: PlanStep[];
  expectedFiles?: string[];
  verificationCommands?: string[];
  debateRecommended: boolean;
  reasonForDebate?: string;
};
