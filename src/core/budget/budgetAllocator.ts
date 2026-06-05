import type { AgentRole } from "../../schemas/agentTask.js";
import { defaultStrongAgentBudget, isStrongAgentRole, type StrongAgentBudgetConfig } from "./strongAgentBudget.js";

export type BudgetDecision = {
  role: AgentRole;
  allowed: boolean;
  reason: string;
  remainingCalls: number;
};

export function allocateStrongAgentCall(role: AgentRole, usedCalls: number, config: StrongAgentBudgetConfig = defaultStrongAgentBudget): BudgetDecision {
  const consumesReserve = config.reserveForRoles.includes(role) || isStrongAgentRole(role);
  if (!consumesReserve) {
    return { role, allowed: true, reason: "Efficient execution role does not consume strong-agent reserve.", remainingCalls: Math.max(0, config.maxCallsPerTask - usedCalls) };
  }
  const remainingCalls = Math.max(0, config.maxCallsPerTask - usedCalls);
  return {
    role,
    allowed: remainingCalls > 0,
    reason: remainingCalls > 0 ? `Strong-agent call reserved for ${role}.` : `Strong-agent call budget exhausted before ${role}.`,
    remainingCalls
  };
}
