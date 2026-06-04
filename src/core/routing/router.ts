import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { agentRoles, type AgentRole } from "../../schemas/agentTask.js";
import { validateExternalAssignment } from "../externalAgents/externalAgentRouter.js";
import { profilesFromConfig } from "./modelProfiles.js";
import { buildRoutingPlan, type AgentRouteOverrides, type RouteAssignment, type RoutingPlan } from "./policies.js";

export class ModelRouter {
  private readonly plan: RoutingPlan;

  constructor(config: TomorrowEdgeConfig) {
    const plan = buildRoutingPlan(config.routing.mode, profilesFromConfig(config), overridesFromConfig(config));
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
}

function overridesFromConfig(config: TomorrowEdgeConfig): AgentRouteOverrides {
  const overrides: AgentRouteOverrides = {};
  for (const role of agentRoles) {
    const agent = config.agents[role];
    if (agent) overrides[role] = { provider: agent.provider, model: agent.model };
  }
  return overrides;
}
