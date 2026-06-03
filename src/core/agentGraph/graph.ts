import type { AgentRole } from "../../schemas/agentTask.js";

export type AgentGraphNode = {
  role: AgentRole;
  dependsOn: AgentRole[];
};

export const defaultAgentGraph: AgentGraphNode[] = [
  { role: "planner", dependsOn: [] },
  { role: "explorer", dependsOn: ["planner"] },
  { role: "coder_a", dependsOn: ["explorer"] },
  { role: "coder_b", dependsOn: ["explorer"] },
  { role: "reviewer", dependsOn: ["coder_a", "coder_b"] },
  { role: "judge", dependsOn: ["reviewer"] },
  { role: "runner", dependsOn: ["judge"] },
  { role: "repairer", dependsOn: ["runner"] },
  { role: "summarizer", dependsOn: ["judge"] }
];
