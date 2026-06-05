import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { agentRoles, type AgentRole } from "../../schemas/agentTask.js";
import { validateExternalAssignment } from "../externalAgents/externalAgentRouter.js";
import { profilesFromConfig } from "./modelProfiles.js";
import { buildRoutingPlan, type AgentRouteOverrides, type RouteAssignment, type RoutingPlan } from "./policies.js";

export type ModelRouterOptions = {
  routeOverrides?: AgentRouteOverrides;
};

export class ModelRouter {
  private readonly plan: RoutingPlan;

  constructor(config: TomorrowEdgeConfig, options: ModelRouterOptions = {}) {
    const plan = buildRoutingPlan(config.routing.mode, profilesFromConfig(config), overridesFromConfig(config, options.routeOverrides));
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

function overridesFromConfig(config: TomorrowEdgeConfig, memoryOverrides: AgentRouteOverrides = {}): AgentRouteOverrides {
  const overrides: AgentRouteOverrides = { ...memoryOverrides };
  for (const role of agentRoles) {
    const agent = config.agents[role];
    if (agent && (agent.provider !== "auto" || agent.model !== "auto")) {
      overrides[role] = { provider: agent.provider, model: agent.model };
    } else if (agent && !overrides[role]) {
      overrides[role] = { provider: agent.provider, model: agent.model };
    }
  }
  return overrides;
}
