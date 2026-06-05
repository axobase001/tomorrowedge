import type { AgentRole } from "../../schemas/agentTask.js";
import { defaultStrongAgentBudget, isStrongAgentRole, type StrongAgentBudgetConfig } from "./strongAgentBudget.js";

export type BudgetDecision = {
  role: AgentRole;
  allowed: boolean;
  reason: string;
  remainingCalls: number;
  estimatedCostUsd?: number;
  escalationSignals: string[];
};

export type StrongAgentAllocationInput = {
  estimatedCostUsd?: number;
  escalationSignals?: string[];
};

export function allocateStrongAgentCall(role: AgentRole, usedCalls: number, config: StrongAgentBudgetConfig = defaultStrongAgentBudget, input: StrongAgentAllocationInput = {}): BudgetDecision {
  const escalationSignals = (input.escalationSignals ?? []).filter((signal) => config.escalateOn.includes(signal));
  const consumesReserve = config.reserveForRoles.includes(role) || isStrongAgentRole(role) || escalationSignals.length > 0;
  if (!consumesReserve) {
    return { role, allowed: true, reason: "Efficient execution role does not consume strong-agent reserve.", remainingCalls: Math.max(0, config.maxCallsPerTask - usedCalls), estimatedCostUsd: input.estimatedCostUsd, escalationSignals };
  }
  if (input.estimatedCostUsd !== undefined && input.estimatedCostUsd > config.maxCostUsd) {
    return {
      role,
      allowed: false,
      reason: `Strong-agent estimated cost $${input.estimatedCostUsd.toFixed(6)} exceeds strong_agents.max_cost_usd $${config.maxCostUsd.toFixed(6)}.`,
      remainingCalls: Math.max(0, config.maxCallsPerTask - usedCalls),
      estimatedCostUsd: input.estimatedCostUsd,
      escalationSignals
    };
  }
  const remainingCalls = Math.max(0, config.maxCallsPerTask - usedCalls);
  return {
    role,
    allowed: remainingCalls > 0,
    reason: remainingCalls > 0 ? `Strong-agent call reserved for ${role}${escalationSignals.length ? ` due to ${escalationSignals.join(", ")}` : ""}.` : `Strong-agent call budget exhausted before ${role}.`,
    remainingCalls,
    estimatedCostUsd: input.estimatedCostUsd,
    escalationSignals
  };
}
