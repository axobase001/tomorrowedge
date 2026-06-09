import { defaultAgentGraph } from "./graph.js";

export function describeSchedule(): string[] {
  return defaultAgentGraph.map((node) => `${node.role}${node.dependsOn.length ? ` after ${node.dependsOn.join(", ")}` : ""}`);
}
// TODO: Implement AgentGraphScheduler class
