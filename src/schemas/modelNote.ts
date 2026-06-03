import type { AgentRole } from "./agentTask.js";

export type ModelNote = {
  id: string;
  role: AgentRole;
  provider: string;
  model: string;
  kind: "plan_advice" | "implementation_advice" | "review_advice" | "judge_advice" | "patch_generation";
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  estimatedCostUsd?: number;
  fallbackUsed?: boolean;
  fallbackFrom?: {
    provider: string;
    model: string;
  };
  fallbackReason?: string;
  error?: string;
};

export type ModelUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
};

export type ModelBudgetStatus = {
  status: "within_budget" | "price_unknown" | "blocked";
  maxCostUsd: number;
  estimatedCostUsd?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  reason: string;
};
