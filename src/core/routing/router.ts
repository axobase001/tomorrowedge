import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { profilesFromConfig } from "./modelProfiles.js";
import { buildRoutingPlan, type RouteAssignment, type RoutingPlan } from "./policies.js";

export class ModelRouter {
  private readonly plan: RoutingPlan;

  constructor(config: TomorrowEdgeConfig) {
    this.plan = buildRoutingPlan(config.routing.mode, profilesFromConfig(config));
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
