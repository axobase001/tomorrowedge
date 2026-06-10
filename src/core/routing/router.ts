import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { agentRoles, type AgentRole } from "../../schemas/agentTask.js";
import type { Plan } from "../../schemas/plan.js";
import { validateExternalAssignment } from "../externalAgents/externalAgentRouter.js";
import type { OrchestrationPolicyGenome } from "../orchestrationPolicy/orchestrationPolicy.js";
import { profilesFromConfig, type ModelProfile } from "./modelProfiles.js";
import { buildRoutingPlan, rerouteRoutingPlanForPlan, type AgentRouteOverrides, type PostPlanRoutingContext, type RouteAssignment, type RoutingPlan, type RoutingPlanChange } from "./policies.js";

export class ModelRouter {
  private plan: RoutingPlan;
  private readonly config: TomorrowEdgeConfig;
  private readonly profiles: ModelProfile[];
  private readonly overrides: AgentRouteOverrides;

  constructor(config: TomorrowEdgeConfig) {
    this.config = config;
    this.profiles = profilesFromConfig(config);
    this.overrides = overridesFromConfig(config);
    const plan = buildRoutingPlan(config.routing.mode, this.profiles, this.overrides);
    this.plan = {
      ...plan,
      assignments: plan.assignments.map((assignment) => validateExternalAssignment(config, assignment)),
      fallbacks: plan.fallbacks.filter((assignment) => !assignment.provider.startsWith("external:"))
    };
  }

  getPlan(): RoutingPlan {
    return this.plan;
  }

  assignmentFor(role: AgentRole): RouteAssignment {
    const assignment = this.plan.assignments.find((item) => item.role === role);
    if (!assignment) {
      throw new Error(`No model assignment for role ${role}`);
    }
    return assignment;
  }

  fallbackFor(role: AgentRole): RouteAssignment | undefined {
    return this.plan.fallbacks.find((item) => item.role === role);
  }

  applyPolicyRoutingPreference(policy: OrchestrationPolicyGenome | undefined): RoutingPlanChange[] {
    const preference = policy?.routingPolicy.routingPreference;
    if (!preference || preference === "balanced" || this.plan.privacyLocked) return [];
    if (this.config.routing.mode === "china" && preference !== "privacy") return [];
    const next = buildRoutingPlan(preference, this.profiles, this.overrides);
    const nextPlan = {
      ...next,
      assignments: next.assignments.map((assignment) => validateExternalAssignment(this.config, assignment)),
      fallbacks: next.fallbacks.filter((assignment) => !assignment.provider.startsWith("external:"))
    };
    const changes = routeChanges(this.plan, nextPlan, `policy routingPreference=${preference}`);
    this.plan = nextPlan;
    return changes;
  }

  rerouteAfterPlan(plan: Plan, context: PostPlanRoutingContext = {}): RoutingPlanChange[] {
    const result = rerouteRoutingPlanForPlan(this.plan, plan, this.config.routing.mode, this.profiles, this.overrides, context);
    this.plan = {
      ...result.plan,
      assignments: result.plan.assignments.map((assignment) => validateExternalAssignment(this.config, assignment)),
      fallbacks: result.plan.fallbacks.filter((assignment) => !assignment.provider.startsWith("external:"))
    };
    return result.changes;
  }
}

function routeChanges(current: RoutingPlan, next: RoutingPlan, reason: string): RoutingPlanChange[] {
  return next.assignments.flatMap((to) => {
    const from = current.assignments.find((assignment) => assignment.role === to.role);
    if (!from || (from.provider === to.provider && from.model === to.model && from.reason === to.reason)) return [];
    return [{ role: to.role, from, to, reason }];
  });
}

function overridesFromConfig(config: TomorrowEdgeConfig): AgentRouteOverrides {
  const overrides: AgentRouteOverrides = {};
  for (const role of agentRoles) {
    const agent = config.agents[role];
    if (agent) overrides[role] = { provider: agent.provider, model: agent.model, reason: agent.reason };
  }
  return overrides;
}
