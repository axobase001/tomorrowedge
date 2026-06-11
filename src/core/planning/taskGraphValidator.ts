import type { AgentRole } from "../../schemas/agentTask.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { ExpectedOutput, TaskGraph, TaskGraphNode, TaskGraphNodeStatus, TaskNodeKind } from "./taskGraph.js";

export type TaskGraphValidationResult = {
  ok: boolean;
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export function validateTaskGraph(graph: TaskGraph): TaskGraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (graph.schemaVersion !== "task-graph/v1") errors.push("task graph schemaVersion must be task-graph/v1");
  if (!graph.nodes.length) errors.push("task graph has no nodes");
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    validateNodeShape(node, errors, warnings);
    if (ids.has(node.id)) errors.push(`duplicate task graph node id: ${node.id}`);
    ids.add(node.id);
  }
  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) errors.push(`node ${node.id} depends on missing node ${dependency}`);
    }
    for (const dependency of node.dependencies) {
      if (!ids.has(dependency)) errors.push(`node ${node.id} legacy dependency points to missing node ${dependency}`);
    }
  }
  if (hasCycle(graph)) errors.push("task graph contains a dependency cycle");
  validateWorkflowRules(graph, errors, warnings);
  if (!graph.entryNodeIds.length) warnings.push("task graph has no explicit entry nodes");
  if (!graph.terminalNodeIds.length) warnings.push("task graph has no explicit terminal nodes");
  const ok = errors.length === 0;
  return { ok, valid: ok, errors, warnings };
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
    const objective = stringValue(node.objective) ?? stringValue(node.detail);
    const phase = eventPhase(node.phase);
    const kind = taskNodeKind(node.kind);
    const ownerRole = agentRole(node.ownerRole) ?? agentRole(arrayOfStrings(node.roleHints)[0]);
    if (!id || !title || !objective || !phase || !kind || !ownerRole) return [];
    const dependsOn = arrayOfStrings(node.dependsOn).length ? arrayOfStrings(node.dependsOn) : arrayOfStrings(node.dependencies);
    const requiredInputs = parseRequiredInputs(node.requiredInputs, arrayOfStrings(node.requiredEvidence));
    const expectedOutputs = parseExpectedOutputs(node.expectedOutputs, arrayOfStrings(node.expectedArtifacts));
    return [{
      id,
      kind,
      title,
      objective,
      detail: objective,
      phase,
      ownerRole,
      roleHints: [ownerRole, ...arrayOfStrings(node.roleHints).map((role) => agentRole(role)).filter((role): role is AgentRole => Boolean(role))],
      dependsOn,
      dependencies: dependsOn,
      requiredInputs,
      expectedOutputs,
      requiredEvidence: requiredInputs.map((item) => item.description),
      expectedArtifacts: expectedOutputs.map((item) => item.description),
      evidenceRefs: arrayOfStrings(node.evidenceRefs),
      artifactRefs: arrayOfStrings(node.artifactRefs),
      files: arrayOfStrings(node.files),
      riskLevel: riskLevel(node.riskLevel),
      mutationAllowed: Boolean(node.mutationAllowed),
      canRunInParallel: Boolean(node.canRunInParallel),
      stopIfFails: typeof node.stopIfFails === "boolean" ? node.stopIfFails : true,
      fallbackRole: agentRole(node.fallbackRole),
      acceptanceCriteria: arrayOfStrings(node.acceptanceCriteria),
      status: nodeStatus(node.status)
    } satisfies TaskGraphNode];
  });
  const candidate: TaskGraph = {
    schemaVersion: "task-graph/v1",
    graphId: stringValue(graph.graphId) || "model_task_graph",
    goal: stringValue(graph.goal) || stringValue(graph.rootObjective) || "",
    rootObjective: stringValue(graph.rootObjective) || stringValue(graph.goal) || "",
    workflowKind: workflowKind(graph.workflowKind),
    riskLevel: riskLevel(graph.riskLevel),
    nodes,
    edges: Array.isArray(graph.edges) ? graph.edges as TaskGraph["edges"] : [],
    entryNodeIds: arrayOfStrings(graph.entryNodeIds),
    terminalNodeIds: arrayOfStrings(graph.terminalNodeIds),
    stopConditions: arrayOfStrings(graph.stopConditions),
    riskBoundaries: arrayOfStrings(graph.riskBoundaries)
  };
  return validateTaskGraph(candidate).ok ? candidate : undefined;
}

function validateNodeShape(node: TaskGraphNode, errors: string[], warnings: string[]): void {
  if (!node.id.trim()) errors.push("task graph node has an empty id");
  if (!node.title.trim()) warnings.push(`node ${node.id} has an empty title`);
  if (!node.objective.trim()) errors.push(`node ${node.id} has an empty objective`);
  if (!node.ownerRole) errors.push(`node ${node.id} has no ownerRole`);
  if (!node.kind) errors.push(`node ${node.id} has no kind`);
  if (!node.phase) errors.push(`node ${node.id} has no phase`);
  if (!node.roleHints.includes(node.ownerRole)) warnings.push(`node ${node.id} roleHints should include ownerRole ${node.ownerRole}`);
}

function validateWorkflowRules(graph: TaskGraph, errors: string[], warnings: string[]): void {
  if (graph.workflowKind === "read_only" || graph.workflowKind === "advisory" || graph.workflowKind === "ask_user") {
    for (const node of graph.nodes) {
      if (node.mutationAllowed) errors.push(`read-only graph node ${node.id} allows mutation`);
      if (["patch", "apply_patch", "verify", "repair"].includes(node.kind)) errors.push(`read-only graph contains mutation node ${node.id}:${node.kind}`);
      if (["coder_a", "coder_b", "runner", "repairer"].includes(node.ownerRole)) errors.push(`read-only graph assigns mutation role ${node.ownerRole} to ${node.id}`);
    }
  }
  const patchLike = graph.workflowKind === "patch" || graph.workflowKind === "vision_patch" || graph.workflowKind === "repair";
  if (patchLike && graph.workflowKind !== "repair") {
    const patchNode = findKind(graph, "patch");
    const reviewNode = findKind(graph, "review");
    const judgeNode = findKind(graph, "judge");
    const applyNode = findKind(graph, "apply_patch");
    const verifyNode = findKind(graph, "verify");
    if (!patchNode) errors.push("patch workflow must include a patch node");
    if (!reviewNode) errors.push("patch workflow must include a review node");
    if (!judgeNode) errors.push("patch workflow must include a judge node");
    if (!applyNode) errors.push("patch workflow must include an apply_patch node");
    if (!verifyNode) errors.push("patch workflow must include a verify node");
    if (applyNode && judgeNode && !applyNode.dependsOn.includes(judgeNode.id)) errors.push("apply_patch must depend on judge node");
    if (verifyNode && applyNode && !verifyNode.dependsOn.includes(applyNode.id)) errors.push("verify_patch must depend on apply_patch unless dry-run is explicit");
    const summarize = findKind(graph, "summarize");
    if (summarize && verifyNode && !summarize.dependsOn.includes(verifyNode.id)) warnings.push("summarize should depend on the verification outcome");
  }
  if (graph.riskLevel === "high" && graph.workflowKind !== "read_only" && graph.workflowKind !== "advisory" && graph.workflowKind !== "ask_user") {
    if (!graph.nodes.some((node) => node.kind === "review" && node.ownerRole === "reviewer")) errors.push("high-risk graph must include reviewer-owned review node");
    if (!graph.nodes.some((node) => node.kind === "judge" && node.ownerRole === "judge")) errors.push("high-risk graph must include judge-owned judge node");
  }
  for (const node of graph.nodes) {
    for (const required of node.requiredInputs.filter((item) => item.required)) {
      if (!upstreamProduces(graph, node, required.id)) {
        errors.push(`node ${node.id} requires ${required.id} but no upstream node produces it`);
      }
    }
  }
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
    for (const dependency of node?.dependsOn ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return graph.nodes.some((node) => visit(node.id));
}

function findKind(graph: TaskGraph, kind: TaskNodeKind): TaskGraphNode | undefined {
  return graph.nodes.find((node) => node.kind === kind);
}

function upstreamProduces(graph: TaskGraph, node: TaskGraphNode, outputId: string): boolean {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    const current = byId.get(nodeId);
    if (!current) return false;
    if (current.expectedOutputs.some((output) => output.id === outputId)) return true;
    return current.dependsOn.some(visit);
  };
  return node.dependsOn.some(visit);
}

function parseRequiredInputs(value: unknown, legacy: string[]): TaskGraphNode["requiredInputs"] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const description = stringValue(record.description);
      const id = stringValue(record.id) ?? `required_${index + 1}`;
      const kind = evidenceKind(record.kind);
      if (!description || !kind) return [];
      return [{ id, kind, description, required: typeof record.required === "boolean" ? record.required : true }];
    });
  }
  return legacy.map((description, index) => ({ id: stableId(description) || `required_${index + 1}`, kind: "artifact" as const, description, required: true }));
}

function parseExpectedOutputs(value: unknown, legacy: string[]): ExpectedOutput[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const description = stringValue(record.description);
      const id = stringValue(record.id) ?? `output_${index + 1}`;
      const kind = outputKind(record.kind);
      if (!description || !kind) return [];
      return [{ id, kind, description }];
    });
  }
  return legacy.map((description, index) => ({ id: stableId(description) || `output_${index + 1}`, kind: "artifact" as const, description }));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function eventPhase(value: unknown): EventPhase | undefined {
  return ["routing", "vision", "planning", "exploration", "coding", "review", "judge", "patch", "shell", "repair", "summary", "memory", "verification"].includes(String(value)) ? value as EventPhase : undefined;
}

function taskNodeKind(value: unknown): TaskNodeKind | undefined {
  return ["inspect", "analyze", "design", "patch", "review", "judge", "apply_patch", "verify", "repair", "summarize", "ask_user"].includes(String(value)) ? value as TaskNodeKind : undefined;
}

function agentRole(value: unknown): AgentRole | undefined {
  return ["core", "planner", "vision", "explorer", "coder_a", "coder_b", "reviewer", "judge", "runner", "repairer", "summarizer"].includes(String(value)) ? value as AgentRole : undefined;
}

function riskLevel(value: unknown): TaskGraph["riskLevel"] {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function workflowKind(value: unknown): TaskGraph["workflowKind"] {
  return ["read_only", "patch", "repair", "vision_patch", "advisory", "ask_user"].includes(String(value)) ? value as TaskGraph["workflowKind"] : undefined;
}

function nodeStatus(value: unknown): TaskGraphNodeStatus {
  return value === "running" || value === "done" || value === "blocked" || value === "skipped" ? value : "pending";
}

function evidenceKind(value: unknown): TaskGraphNode["requiredInputs"][number]["kind"] | undefined {
  return ["file", "diff", "review", "judge", "shell", "artifact", "reasoning"].includes(String(value)) ? value as TaskGraphNode["requiredInputs"][number]["kind"] : undefined;
}

function outputKind(value: unknown): ExpectedOutput["kind"] | undefined {
  return ["context", "plan", "patch", "review", "judgment", "test_result", "summary", "artifact"].includes(String(value)) ? value as ExpectedOutput["kind"] : undefined;
}

function stableId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
