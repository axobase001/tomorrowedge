import type { AgentRole } from "../../schemas/agentTask.js";
import type { RoleGraph, RoleNode } from "./roleGraph.js";

export type RoleNodeExecutionStatus = "pending" | "ready" | "running" | "success" | "failed" | "blocked" | "skipped";

export type RoleNodeExecution = {
  nodeId: string;
  role: AgentRole;
  status: RoleNodeExecutionStatus;
  attempts: number;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  artifacts: string[];
  evidence: string[];
  error?: string;
};

export type RoleNodeResult = {
  nodeId?: string;
  role: AgentRole;
  status: "success" | "failed" | "blocked" | "skipped";
  summary: string;
  artifacts?: string[];
  evidence?: string[];
  error?: string;
};

export type RoleGraphExecutionState = {
  graph: RoleGraph;
  nodes: Record<string, RoleNodeExecution>;
  results: RoleNodeResult[];
  stopReason?: string;
};

export function createRoleGraphExecutionState(graph: RoleGraph): RoleGraphExecutionState {
  const state: RoleGraphExecutionState = {
    graph,
    nodes: Object.fromEntries(graph.nodes.map((node) => [node.id, {
      nodeId: node.id,
      role: node.role,
      status: "pending" as const,
      attempts: 0,
      artifacts: [],
      evidence: []
    }])),
    results: []
  };
  for (const node of readyRoleNodes(state)) {
    state.nodes[node.id]!.status = "ready";
  }
  return state;
}

export function readyRoleNodes(state: RoleGraphExecutionState): RoleNode[] {
  return state.graph.nodes.filter((node) => {
    const execution = state.nodes[node.id];
    if (!execution || !["pending", "ready"].includes(execution.status)) return false;
    return node.dependencies.every((dependency) => {
      const dependencyState = state.nodes[dependency];
      const dependencyNode = state.graph.nodes.find((item) => item.id === dependency);
      if (!dependencyState) return true;
      return dependencyState.status === "success"
        || Boolean(dependencyNode?.canSkip && dependencyState.status === "skipped")
        || Boolean(dependencyNode && !dependencyNode.required && (dependencyState.status === "failed" || dependencyState.status === "blocked"));
    });
  });
}

export function canRunRoleNode(state: RoleGraphExecutionState, role: AgentRole, nodeId?: string): boolean {
  const node = nodeForRole(state, role, nodeId);
  return Boolean(node && readyRoleNodes(state).some((ready) => ready.id === node.id));
}

export function beginRoleNode(state: RoleGraphExecutionState, role: AgentRole, nodeId?: string, now = new Date().toISOString()): RoleNodeExecution | undefined {
  const node = nodeForRole(state, role, nodeId);
  if (!node || !canRunRoleNode(state, role, node.id)) return undefined;
  const execution = state.nodes[node.id]!;
  execution.status = "running";
  execution.startedAt = execution.startedAt ?? now;
  execution.attempts += 1;
  return execution;
}

export function completeRoleNode(state: RoleGraphExecutionState, role: AgentRole, result: Omit<RoleNodeResult, "role" | "status"> & { status?: "success" }, nodeId?: string): RoleNodeExecution | undefined {
  return finishRoleNode(state, { ...result, role, nodeId: nodeId ?? result.nodeId, status: "success" });
}

export function blockRoleNode(state: RoleGraphExecutionState, role: AgentRole, reason: string, nodeId?: string): RoleNodeExecution | undefined {
  return finishRoleNode(state, { role, nodeId, status: "blocked", summary: reason, error: reason });
}

export function skipRoleNode(state: RoleGraphExecutionState, role: AgentRole, reason: string, nodeId?: string): RoleNodeExecution | undefined {
  return finishRoleNode(state, { role, nodeId, status: "skipped", summary: reason, evidence: [reason] });
}

export function markRoleNodeRunning(state: RoleGraphExecutionState, role: AgentRole, now = new Date().toISOString()): RoleNodeExecution | undefined {
  return beginRoleNode(state, role, undefined, now);
}

export function markRoleNodeResult(state: RoleGraphExecutionState, result: RoleNodeResult, now = new Date().toISOString()): RoleNodeExecution | undefined {
  return finishRoleNode(state, result, now);
}

function finishRoleNode(state: RoleGraphExecutionState, result: RoleNodeResult, now = new Date().toISOString()): RoleNodeExecution | undefined {
  const node = nodeForRole(state, result.role, result.nodeId);
  if (!node) return undefined;
  const execution = state.nodes[node.id]!;
  if (result.status === "success" && execution.status !== "running" && !canRunRoleNode(state, result.role, node.id)) {
    state.stopReason = `role node ${node.id} cannot complete before dependencies are satisfied`;
    return undefined;
  }
  if (result.status === "success" && execution.status !== "running") {
    execution.startedAt = execution.startedAt ?? now;
    execution.attempts += 1;
  }
  execution.status = result.status;
  execution.endedAt = now;
  execution.summary = result.summary;
  execution.artifacts = [...new Set([...execution.artifacts, ...(result.artifacts ?? [])])];
  execution.evidence = [...new Set([...execution.evidence, ...(result.evidence ?? [])])];
  execution.error = result.error;
  state.results.push({ ...result, nodeId: node.id });
  for (const ready of readyRoleNodes(state)) {
    if (state.nodes[ready.id]?.status === "pending") state.nodes[ready.id]!.status = "ready";
  }
  state.stopReason = stopReasonForState(state);
  return execution;
}

export function shouldStopRoleGraph(state: RoleGraphExecutionState): boolean {
  return Boolean(state.stopReason);
}

export function roleGraphExecutionSummary(state: RoleGraphExecutionState): string {
  const counts = Object.values(state.nodes).reduce<Record<RoleNodeExecutionStatus, number>>((acc, node) => {
    acc[node.status] += 1;
    return acc;
  }, { pending: 0, ready: 0, running: 0, success: 0, failed: 0, blocked: 0, skipped: 0 });
  return `ready=${counts.ready} running=${counts.running} success=${counts.success} failed=${counts.failed} blocked=${counts.blocked} skipped=${counts.skipped}`;
}

function nextNodeForRole(state: RoleGraphExecutionState, role: AgentRole): RoleNode | undefined {
  return state.graph.nodes.find((node) => node.role === role && ["ready", "pending", "running"].includes(state.nodes[node.id]?.status ?? "pending"));
}

function nodeForRole(state: RoleGraphExecutionState, role: AgentRole, nodeId?: string): RoleNode | undefined {
  if (nodeId) return state.graph.nodes.find((node) => node.id === nodeId && node.role === role);
  return nextNodeForRole(state, role);
}

function stopReasonForState(state: RoleGraphExecutionState): string | undefined {
  const requiredFailed = state.graph.nodes.find((node) => {
    const status = state.nodes[node.id]?.status;
    return node.required && (status === "failed" || status === "blocked");
  });
  if (requiredFailed) return `required role node ${requiredFailed.id} ended as ${state.nodes[requiredFailed.id]?.status}`;
  const allTerminal = state.graph.nodes.every((node) => ["success", "failed", "blocked", "skipped"].includes(state.nodes[node.id]?.status ?? "pending"));
  return allTerminal ? "role graph complete" : undefined;
}
