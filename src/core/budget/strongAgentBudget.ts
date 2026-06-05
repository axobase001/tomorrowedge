import type { AgentRole } from "../../schemas/agentTask.js";

export type StrongAgentBudgetConfig = {
  maxCallsPerTask: number;
  maxCostUsd: number;
  reserveForRoles: AgentRole[];
  escalateOn: string[];
};

export const defaultStrongAgentBudget: StrongAgentBudgetConfig = {
  maxCallsPerTask: 3,
  maxCostUsd: 2,
  reserveForRoles: ["planner", "reviewer", "judge"],
  escalateOn: ["high_risk_patch", "repeated_test_failure", "reviewer_disagreement", "security_sensitive_change"]
};

export function isStrongAgentRole(role: AgentRole): boolean {
  return role === "core" || role === "planner" || role === "reviewer" || role === "judge";
}
