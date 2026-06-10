import type { TaskGraph } from "./taskGraph.js";

export type TaskGraphValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateTaskGraph(graph: TaskGraph): TaskGraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!graph.nodes.length) errors.push("task graph has no nodes");
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id.trim()) errors.push("task graph node has an empty id");
    if (ids.has(node.id)) errors.push(`duplicate task graph node id: ${node.id}`);
    ids.add(node.id);
    if (!node.title.trim()) warnings.push(`node ${node.id} has an empty title`);
    for (const dependency of node.dependencies) {
      if (!ids.has(dependency) && !graph.nodes.some((candidate) => candidate.id === dependency)) {
        errors.push(`node ${node.id} depends on missing node ${dependency}`);
      }
    }
  }
  if (hasCycle(graph)) errors.push("task graph contains a dependency cycle");
  if (!graph.entryNodeIds.length) warnings.push("task graph has no explicit entry nodes");
  if (!graph.terminalNodeIds.length) warnings.push("task graph has no explicit terminal nodes");
  return { ok: errors.length === 0, errors, warnings };
}

export function parseTaskGraphCandidate(value: unknown): TaskGraph | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const graph = value as Partial<TaskGraph>;
  if (!Array.isArray(graph.nodes)) return undefined;
  const nodes = graph.nodes.flatMap((rawNode) => {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) return [];
    const node = rawNode as Record<string, unknown>;
    const id = stringValue(node.id);
    const title = stringValue(node.title);
    const detail = stringValue(node.detail);
    const phase = stringValue(node.phase);
    if (!id || !title || !detail || !phase) return [];
    return [{
      id,
      title,
      detail,
      phase: phase as TaskGraph["nodes"][number]["phase"],
      roleHints: arrayOfStrings(node.roleHints) as TaskGraph["nodes"][number]["roleHints"],
      dependencies: arrayOfStrings(node.dependencies),
      requiredEvidence: arrayOfStrings(node.requiredEvidence),
      expectedArtifacts: arrayOfStrings(node.expectedArtifacts),
      status: (stringValue(node.status) || "pending") as TaskGraph["nodes"][number]["status"]
    }];
  });
  const candidate: TaskGraph = {
    graphId: stringValue(graph.graphId) || "model_task_graph",
    goal: stringValue(graph.goal) || "",
    workflowKind: stringValue(graph.workflowKind) as TaskGraph["workflowKind"],
    riskLevel: (stringValue(graph.riskLevel) || "medium") as TaskGraph["riskLevel"],
    nodes,
    edges: Array.isArray(graph.edges) ? graph.edges as TaskGraph["edges"] : [],
    entryNodeIds: arrayOfStrings(graph.entryNodeIds),
    terminalNodeIds: arrayOfStrings(graph.terminalNodeIds)
  };
  return validateTaskGraph(candidate).ok ? candidate : undefined;
}

function hasCycle(graph: TaskGraph): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const node = byId.get(id);
    for (const dependency of node?.dependencies ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return graph.nodes.some((node) => visit(node.id));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}
