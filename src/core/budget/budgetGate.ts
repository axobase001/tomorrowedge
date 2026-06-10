import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { RouteAssignment } from "../routing/policies.js";
import type { EventPhase } from "../events/eventTypes.js";
import { allocateStrongAgentCall } from "./budgetAllocator.js";

export type BudgetRuntimeState = {
  strongAgentCallsUsed: number;
  roleCallsUsed: Partial<Record<AgentRole, number>>;
  blockedRoles: Partial<Record<AgentRole, string>>;
  reservations: BudgetReservation[];
};

export type BudgetGateDecision = {
  role: AgentRole;
  phase: EventPhase;
  action: "allow" | "fallback" | "block";
  reason: string;
  assignment: RouteAssignment;
  fallbackAssignment?: RouteAssignment;
  scope: "global_strong_pool" | "per_role" | "efficient";
  consumesGlobal: boolean;
  estimatedCostUsd?: number;
  remainingCalls?: number;
};

export type BudgetReservation = {
  id: string;
  role: AgentRole;
  phase: EventPhase;
  scope: BudgetGateDecision["scope"];
  consumesGlobal: boolean;
  committed: boolean;
  released: boolean;
};

export type RoleBudgetInput = {
  maxCostPerCallUsd?: number;
  maxCallsPerTask?: number;
};

export type ModelInvocationKind = "model_planner" | "task_governance" | "live_patch" | "live_advisory" | "pre_judge_debate";

export function evaluateModelCallInvocation(input: {
  config: TomorrowEdgeConfig;
  runtime: BudgetRuntimeState;
  invocation: ModelInvocationKind;
  role: AgentRole;
  assignment: RouteAssignment;
  roleBudget?: RoleBudgetInput;
  estimatedCostUsd?: number;
  escalationSignals?: string[];
  canFallback?: boolean;
}): BudgetGateDecision {
  const config = {
    ...input.config,
    strong_agents: {
      ...input.config.strong_agents,
      escalate_on: [...new Set([...input.config.strong_agents.escalate_on, input.invocation])]
    }
  };
  return evaluateRoleInvocation({
    config,
    runtime: input.runtime,
    role: input.role,
    phase: phaseForInvocation(input.invocation),
    assignment: input.assignment,
    roleBudget: input.roleBudget,
    estimatedCostUsd: input.estimatedCostUsd,
    escalationSignals: [...new Set([input.invocation, ...(input.escalationSignals ?? [])])],
    canFallback: input.canFallback
  });
}

export function createBudgetRuntimeState(): BudgetRuntimeState {
  return {
    strongAgentCallsUsed: 0,
    roleCallsUsed: {},
    blockedRoles: {},
    reservations: []
  };
}

export function evaluateRoleInvocation(input: {
  config: TomorrowEdgeConfig;
  runtime: BudgetRuntimeState;
  role: AgentRole;
  phase: EventPhase;
  assignment: RouteAssignment;
  roleBudget?: RoleBudgetInput;
  estimatedCostUsd?: number;
  escalationSignals?: string[];
  canFallback?: boolean;
}): BudgetGateDecision {
  const decision = allocateStrongAgentCall(input.role, input.runtime.strongAgentCallsUsed, {
    maxCallsPerTask: input.config.strong_agents.max_calls_per_task,
    maxCostUsd: input.config.strong_agents.max_cost_usd,
    reserveForRoles: input.config.strong_agents.reserve_for_roles,
    escalateOn: input.config.strong_agents.escalate_on
  }, {
    estimatedCostUsd: input.estimatedCostUsd,
    escalationSignals: input.escalationSignals,
    roleBudget: input.roleBudget,
    roleUsedCalls: input.runtime.roleCallsUsed[input.role] ?? 0
  });
  if (decision.allowed) {
    return {
      role: input.role,
      phase: input.phase,
      action: "allow",
      reason: decision.reason,
      assignment: input.assignment,
      scope: decision.scope,
      consumesGlobal: decision.consumesGlobal,
      estimatedCostUsd: decision.estimatedCostUsd,
      remainingCalls: decision.remainingCalls
    };
  }
  return {
    role: input.role,
    phase: input.phase,
    action: input.canFallback ? "fallback" : "block",
    reason: decision.reason,
    assignment: input.assignment,
    fallbackAssignment: input.canFallback ? nativeFallbackAssignment(input.role, input.assignment) : undefined,
    scope: decision.scope,
    consumesGlobal: decision.consumesGlobal,
    estimatedCostUsd: decision.estimatedCostUsd,
    remainingCalls: decision.remainingCalls
  };
}

export function reserveRoleCall(runtime: BudgetRuntimeState, decision: BudgetGateDecision): BudgetReservation {
  const reservation: BudgetReservation = {
    id: `${decision.role}_${decision.phase}_${runtime.reservations.length + 1}`,
    role: decision.role,
    phase: decision.phase,
    scope: decision.scope,
    consumesGlobal: decision.consumesGlobal,
    committed: false,
    released: false
  };
  runtime.reservations.push(reservation);
  return reservation;
}

export function commitRoleCall(runtime: BudgetRuntimeState, reservation: BudgetReservation): void {
  if (reservation.committed || reservation.released) return;
  reservation.committed = true;
  if (reservation.scope === "per_role") {
    runtime.roleCallsUsed[reservation.role] = (runtime.roleCallsUsed[reservation.role] ?? 0) + 1;
  }
  if (reservation.consumesGlobal || reservation.scope === "global_strong_pool") {
    runtime.strongAgentCallsUsed += 1;
  }
}

export function releaseRoleCall(_runtime: BudgetRuntimeState, reservation: BudgetReservation, _reason: string): void {
  if (reservation.committed) return;
  reservation.released = true;
}

export function nativeFallbackAssignment(role: AgentRole, assignment: RouteAssignment): RouteAssignment {
  return {
    role,
    provider: "local_tool",
    model: `native_${role}`,
    reason: `Budget gate blocked ${assignment.provider}/${assignment.model}; using native ${role} fallback.`
  };
}

export function canFallbackWhenBudgetBlocked(role: AgentRole): boolean {
  return ["planner", "coder_a", "reviewer", "judge"].includes(role);
}

function phaseForInvocation(invocation: ModelInvocationKind): EventPhase {
  if (invocation === "live_patch") return "coding";
  if (invocation === "pre_judge_debate") return "judge";
  return "planning";
}
