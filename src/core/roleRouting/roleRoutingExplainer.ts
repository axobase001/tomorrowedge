import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { RouteAssignment } from "../routing/policies.js";

export function explainRoleRouting(config: TomorrowEdgeConfig, assignment: RouteAssignment): string {
  const external = assignment.provider.startsWith("external:");
  const strongRole = ["core", "planner", "reviewer", "judge"].includes(assignment.role);
  const budget = `routing budget=$${config.routing.max_cost_usd}`;
  if (external && strongRole) return `${assignment.reason}; ${assignment.role} uses external strong agent because this role controls high-value decisions; ${budget}`;
  if (assignment.provider === "local_tool") return `${assignment.reason}; local execution is kept inside the cockpit trace`;
  if (strongRole) return `${assignment.reason}; strong decision role reserved for reasoning/review quality; ${budget}`;
  return `${assignment.reason}; execution role can prefer cost, latency, and context length; ${budget}`;
}
