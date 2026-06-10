import type { AgentRole } from "../../schemas/agentTask.js";
import type { RoleNode } from "../orchestration/roleGraph.js";
import type { TaskGraph, TaskGraphNode } from "./taskGraph.js";

export function nextReadyTaskNodes(graph: TaskGraph): TaskGraphNode[] {
  return graph.nodes.filter((node) => {
    if (node.status !== "pending") return false;
    return node.dependsOn.every((dependency) => {
      const dependencyNode = graph.nodes.find((item) => item.id === dependency);
      return !dependencyNode || dependencyNode.status === "done" || dependencyNode.status === "skipped";
    });
  });
}

export function taskNodeActionId(node: TaskGraphNode): string {
  if (node.kind === "apply_patch") return "patch_runner";
  if (node.kind === "verify") return "test_runner";
  if (node.kind === "summarize") return "summarizer";
  if (node.kind === "review") return "reviewer";
  if (node.kind === "judge") return "judge";
  if (node.kind === "patch") return node.ownerRole === "coder_b" ? "coder_b" : "coder_a";
  return node.ownerRole;
}

export function readyTaskNodesForRoleNode(graph: TaskGraph | undefined, roleNode: RoleNode): TaskGraphNode[] {
  if (!graph) return [];
  return nextReadyTaskNodes(graph).filter((node) => taskNodeActionId(node) === roleNode.id || node.ownerRole === roleNode.role && taskNodeActionId(node) === roleNode.role);
}

export function taskGraphAllowsRoleNode(graph: TaskGraph | undefined, roleNode: RoleNode): boolean {
  if (!graph) return true;
  return readyTaskNodesForRoleNode(graph, roleNode).length > 0 || roleNodeCanRunWithoutTaskNode(roleNode);
}

export function roleNodeCanRunWithoutTaskNode(roleNode: RoleNode): boolean {
  return roleNode.id === "coder_b";
}

export function roleForTaskNode(node: TaskGraphNode): AgentRole {
  return node.ownerRole;
}
