import type { AgentRole } from "../../schemas/agentTask.js";

export function roleCostPriority(role: AgentRole): "scarce" | "balanced" | "cheap_first" {
  if (role === "core" || role === "planner" || role === "reviewer" || role === "judge") return "scarce";
  if (role === "coder_a" || role === "coder_b" || role === "explorer") return "cheap_first";
  return "balanced";
}
