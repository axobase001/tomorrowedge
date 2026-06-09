import type { AgentRole } from "../../schemas/agentTask.js";
import { defaultStrongAgentBudget, isStrongAgentRole, type StrongAgentBudgetConfig } from "./strongAgentBudget.js";

export type BudgetDecision = {
  role: AgentRole;
  allowed: boolean;
  reason: string;
  remainingCalls: number;
  estimatedCostUsd?: number;
  escalationSignals: string[];
  scope: "global_strong_pool" | "per_role" | "efficient";
};

export type StrongAgentAllocationInput = {
  estimatedCostUsd?: number;
  escalationSignals?: string[];
  roleBudget?: {
    maxCostPerCallUsd?: number;
    maxCallsPerTask?: number;
  };
  roleUsedCalls?: number;
};

export function allocateStrongAgentCall(role: AgentRole, usedCalls: number, config: StrongAgentBudgetConfig = defaultStrongAgentBudget, input: StrongAgentAllocationInput = {}): BudgetDecision {
  if (input.roleBudget) {
    const roleUsedCalls = input.roleUsedCalls ?? 0;
    const maxCalls = input.roleBudget.maxCallsPerTask ?? Number.POSITIVE_INFINITY;
    const maxCost = input.roleBudget.maxCostPerCallUsd;
    const remainingCalls = Number.isFinite(maxCalls) ? Math.max(0, maxCalls - roleUsedCalls) : Number.MAX_SAFE_INTEGER;
    if (maxCost !== undefined && input.estimatedCostUsd !== undefined && input.estimatedCostUsd > maxCost) {
      return {
        role,
        allowed: false,
        reason: `Role ${role} estimated cost $${input.estimatedCostUsd.toFixed(6)} exceeds agents.${role}.budget.max_cost_per_call_usd $${maxCost.toFixed(6)}.`,
        remainingCalls,
        estimatedCostUsd: input.estimatedCostUsd,
        escalationSignals: [],
        scope: "per_role"
      };
    }
    return {
      role,
      allowed: remainingCalls > 0,
      reason: remainingCalls > 0 ? `Role-specific budget allows ${role}; remaining role calls=${remainingCalls}.` : `Role-specific call budget exhausted before ${role}.`,
      remainingCalls,
      estimatedCostUsd: input.estimatedCostUsd,
      escalationSignals: [],
      scope: "per_role"
    };
  }
  const escalationSignals = (input.escalationSignals ?? []).filter((signal) => config.escalateOn.includes(signal));
  const consumesReserve = config.reserveForRoles.includes(role) || isStrongAgentRole(role) || escalationSignals.length > 0;
  if (!consumesReserve) {
    return { role, allowed: true, reason: "Efficient execution role does not consume strong-agent reserve.", remainingCalls: Math.max(0, config.maxCallsPerTask - usedCalls), estimatedCostUsd: input.estimatedCostUsd, escalationSignals, scope: "efficient" };
  }
  if (input.estimatedCostUsd !== undefined && input.estimatedCostUsd > config.maxCostUsd) {
    return {
      role,
      allowed: false,
      reason: `Strong-agent estimated cost $${input.estimatedCostUsd.toFixed(6)} exceeds strong_agents.max_cost_usd $${config.maxCostUsd.toFixed(6)}.`,
      remainingCalls: Math.max(0, config.maxCallsPerTask - usedCalls),
      estimatedCostUsd: input.estimatedCostUsd,
      escalationSignals,
      scope: "global_strong_pool"
    };
  }
  const remainingCalls = Math.max(0, config.maxCallsPerTask - usedCalls);
  return {
    role,
    allowed: remainingCalls > 0,
    reason: remainingCalls > 0 ? `Strong-agent call reserved for ${role}${escalationSignals.length ? ` due to ${escalationSignals.join(", ")}` : ""}.` : `Strong-agent call budget exhausted before ${role}.`,
    remainingCalls,
    estimatedCostUsd: input.estimatedCostUsd,
    escalationSignals,
    scope: "global_strong_pool"
  };
}
