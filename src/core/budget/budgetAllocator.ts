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
  consumesGlobal: boolean;
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
  const escalationSignals = (input.escalationSignals ?? []).filter((signal) => config.escalateOn.includes(signal));
  const consumesReserve = config.reserveForRoles.includes(role) || isStrongAgentRole(role) || escalationSignals.length > 0;
  if (input.roleBudget) {
    const roleUsedCalls = input.roleUsedCalls ?? 0;
    const maxCalls = input.roleBudget.maxCallsPerTask ?? Number.POSITIVE_INFINITY;
    const maxCost = input.roleBudget.maxCostPerCallUsd;
    const roleRemainingCalls = Number.isFinite(maxCalls) ? Math.max(0, maxCalls - roleUsedCalls) : Number.MAX_SAFE_INTEGER;
    const globalRemainingCalls = consumesReserve ? Math.max(0, config.maxCallsPerTask - usedCalls) : Number.MAX_SAFE_INTEGER;
    const remainingCalls = Math.min(roleRemainingCalls, globalRemainingCalls);
    if (consumesReserve && input.estimatedCostUsd !== undefined && input.estimatedCostUsd > config.maxCostUsd) {
      return {
        role,
        allowed: false,
        reason: `Strong-agent estimated cost $${input.estimatedCostUsd.toFixed(6)} exceeds strong_agents.max_cost_usd $${config.maxCostUsd.toFixed(6)}.`,
        remainingCalls,
        estimatedCostUsd: input.estimatedCostUsd,
        escalationSignals,
        scope: "per_role",
        consumesGlobal: true
      };
    }
    if (maxCost !== undefined && input.estimatedCostUsd !== undefined && input.estimatedCostUsd > maxCost) {
      return {
        role,
        allowed: false,
        reason: `Role ${role} estimated cost $${input.estimatedCostUsd.toFixed(6)} exceeds agents.${role}.budget.max_cost_per_call_usd $${maxCost.toFixed(6)}.`,
        remainingCalls,
        estimatedCostUsd: input.estimatedCostUsd,
        escalationSignals,
        scope: "per_role",
        consumesGlobal: consumesReserve
      };
    }
    if (consumesReserve && globalRemainingCalls <= 0) {
      return {
        role,
        allowed: false,
        reason: `Strong-agent call budget exhausted before ${role}.`,
        remainingCalls,
        estimatedCostUsd: input.estimatedCostUsd,
        escalationSignals,
        scope: "per_role",
        consumesGlobal: true
      };
    }
    if (roleRemainingCalls <= 0) {
      return {
        role,
        allowed: false,
        reason: `Role-specific call budget exhausted before ${role}.`,
        remainingCalls,
        estimatedCostUsd: input.estimatedCostUsd,
        escalationSignals,
        scope: "per_role",
        consumesGlobal: consumesReserve
      };
    }
    return {
      role,
      allowed: true,
      reason: consumesReserve
        ? `Role-specific budget allows ${role}; remaining role calls=${roleRemainingCalls}; global strong-agent remaining=${globalRemainingCalls}.`
        : `Role-specific budget allows ${role}; remaining role calls=${roleRemainingCalls}.`,
      remainingCalls,
      estimatedCostUsd: input.estimatedCostUsd,
      escalationSignals,
      scope: "per_role",
      consumesGlobal: consumesReserve
    };
  }
  if (!consumesReserve) {
    return { role, allowed: true, reason: "Efficient execution role does not consume strong-agent reserve.", remainingCalls: Math.max(0, config.maxCallsPerTask - usedCalls), estimatedCostUsd: input.estimatedCostUsd, escalationSignals, scope: "efficient", consumesGlobal: false };
  }
  if (input.estimatedCostUsd !== undefined && input.estimatedCostUsd > config.maxCostUsd) {
    return {
      role,
      allowed: false,
      reason: `Strong-agent estimated cost $${input.estimatedCostUsd.toFixed(6)} exceeds strong_agents.max_cost_usd $${config.maxCostUsd.toFixed(6)}.`,
      remainingCalls: Math.max(0, config.maxCallsPerTask - usedCalls),
      estimatedCostUsd: input.estimatedCostUsd,
      escalationSignals,
      scope: "global_strong_pool",
      consumesGlobal: true
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
    scope: "global_strong_pool",
    consumesGlobal: true
  };
}
