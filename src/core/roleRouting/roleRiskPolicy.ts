import type { AgentRole } from "../../schemas/agentTask.js";

export function roleRiskSensitivity(role: AgentRole): "low" | "medium" | "high" {
  if (role === "reviewer" || role === "judge" || role === "core") return "high";
  if (role === "planner" || role === "repairer") return "medium";
  return "low";
}
