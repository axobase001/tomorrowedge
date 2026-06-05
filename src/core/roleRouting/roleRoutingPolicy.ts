import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { RouteAssignment } from "../routing/policies.js";
import { explainRoleRouting } from "./roleRoutingExplainer.js";

export type RoleRoutingDecision = {
  role: AgentRole;
  provider: string;
  model: string;
  reason: string;
  policyTags: string[];
};

export function buildRoleRoutingDecision(config: TomorrowEdgeConfig, assignment: RouteAssignment): RoleRoutingDecision {
  return {
    role: assignment.role,
    provider: assignment.provider,
    model: assignment.model,
    reason: explainRoleRouting(config, assignment),
    policyTags: policyTagsForRole(assignment.role)
  };
}

function policyTagsForRole(role: AgentRole): string[] {
  if (role === "planner" || role === "core" || role === "reviewer" || role === "judge") return ["strong_reasoning", "decision_resource"];
  if (role === "coder_a" || role === "coder_b" || role === "explorer") return ["execution", "cost_sensitive"];
  if (role === "runner") return ["local_tool"];
  return ["workflow_support"];
}
