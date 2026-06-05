import type { AgentRole } from "../../schemas/agentTask.js";

export function requiredCapabilitiesForRole(role: AgentRole): string[] {
  if (role === "vision") return ["vision", "ocr"];
  if (role === "planner" || role === "core") return ["planning", "reasoning"];
  if (role === "reviewer") return ["review", "conservative"];
  if (role === "judge") return ["reasoning", "judgment"];
  if (role === "coder_a" || role === "coder_b" || role === "repairer") return ["coding"];
  return [];
}
