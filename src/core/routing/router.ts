import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { agentRoles, type AgentRole } from "../../schemas/agentTask.js";
import type { Plan } from "../../schemas/plan.js";
import { validateExternalAssignment } from "../externalAgents/externalAgentRouter.js";
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

function overridesFromConfig(config: TomorrowEdgeConfig): AgentRouteOverrides {
  const overrides: AgentRouteOverrides = {};
  for (const role of agentRoles) {
    const agent = config.agents[role];
    if (agent) overrides[role] = { provider: agent.provider, model: agent.model, reason: agent.reason };
  }
  return overrides;
}
