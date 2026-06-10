import type { AgentRole } from "../../schemas/agentTask.js";
import type { RiskLevel } from "../../schemas/plan.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { WorkflowKind } from "./workflowKind.js";

export type StopCondition =
  | "read_only_complete"
  | "judge_abort"
  | "no_patch_candidate"
  | "empty_diff"
  | "repeated_repair"
  | "budget_blocked_without_fallback";

export type RoleNode = {
  id: string;
  role: AgentRole;
  required: boolean;
  dependencies: string[];
  canFallback: boolean;
  canSkip: boolean;
  maxRetries: number;
  produces: string[];
  consumes: string[];
};

export type RoleGraph = {
  workflowKind: WorkflowKind | "debate_patch" | "high_risk_patch" | "repair_loop";
  nodes: RoleNode[];
  stopConditions: StopCondition[];
};

export type BuildRoleGraphInput = {
  workflowKind: WorkflowKind;
  highRisk?: boolean;
  riskLevel?: RiskLevel;
  debate?: boolean;
  allowParallelRoles?: boolean;
  repairLoop?: boolean;
  allowedRoles?: AgentRole[];
  allowedPhases?: EventPhase[];
};

export function buildRoleGraph(input: BuildRoleGraphInput): RoleGraph {
  const highRisk = Boolean(input.highRisk || input.riskLevel === "high");
  const allowParallelRoles = input.allowParallelRoles !== false;
  let graph: RoleGraph;
  if (input.repairLoop) return constrainRoleGraph(repairLoopGraph(), input, highRisk);
  if (input.workflowKind === "read_only" || input.workflowKind === "advisory") {
    graph = readOnlyGraph(input.workflowKind, Boolean(highRisk || input.debate));
    return constrainRoleGraph(graph, input, highRisk);
  }
  if (highRisk) return constrainRoleGraph(patchGraph("high_risk_patch", true, allowParallelRoles), input, highRisk);
  if (input.debate && allowParallelRoles) return constrainRoleGraph(patchGraph("debate_patch", false, true), input, highRisk);
  if (input.workflowKind === "vision_patch") return constrainRoleGraph(patchGraph("vision_patch", false, false), input, highRisk);
  if (input.workflowKind === "ask_user") {
    graph = {
      workflowKind: "ask_user",
      nodes: [node("planner", [], { required: true, produces: ["clarifying_question"] })],
      stopConditions: ["budget_blocked_without_fallback"]
    };
    return constrainRoleGraph(graph, input, highRisk);
  }
  return constrainRoleGraph(patchGraph("patch", false, false), input, highRisk);
}

export function optionalNodeCanSkip(graph: RoleGraph, nodeId: string): boolean {
  const found = graph.nodes.find((nodeItem) => nodeItem.id === nodeId);
  return Boolean(found && !found.required && found.canSkip);
}

function readOnlyGraph(workflowKind: "read_only" | "advisory", governed = false): RoleGraph {
  const nodes: RoleNode[] = [
    node("planner", [], { produces: ["plan"] }),
    node("explorer", ["planner"], { produces: ["context"], consumes: ["plan"] })
  ];
  if (governed) {
    nodes.push(
      node("reviewer", ["explorer"], { required: false, canSkip: true, produces: ["review_advice"], consumes: ["plan", "context"] }),
      node("judge", ["reviewer"], { required: false, canSkip: true, produces: ["judge_advice"], consumes: ["plan", "context", "review_advice"] })
    );
  }
  nodes.push(node("summarizer", governed ? ["judge"] : ["explorer"], { produces: ["summary"], consumes: governed ? ["plan", "context", "review_advice", "judge_advice"] : ["plan", "context"] }));
  return {
    workflowKind,
    nodes,
    stopConditions: ["read_only_complete", "budget_blocked_without_fallback"]
  };
}

function patchGraph(workflowKind: RoleGraph["workflowKind"], highRisk: boolean, debate: boolean): RoleGraph {
  const nodes: RoleNode[] = [
    node("planner", [], { produces: ["plan"] }),
    node("explorer", ["planner"], { produces: ["context"], consumes: ["plan"] }),
    node("coder_a", ["explorer"], { produces: ["patch_candidate", "patch_evidence"], consumes: ["plan", "context"] })
  ];
  if (debate) nodes.push(node("coder_b", ["explorer"], { required: false, canSkip: true, produces: ["patch_candidate", "patch_evidence"], consumes: ["plan", "context"] }));
  nodes.push(
    node("reviewer", debate || highRisk ? ["coder_a", "coder_b"] : ["coder_a"], { required: highRisk, produces: ["review_evidence"], consumes: ["patch_candidate", "patch_evidence"] }),
    node("judge", ["reviewer"], { required: true, produces: ["judge_decision"], consumes: ["patch_candidate", "patch_evidence", "review_evidence"] }),
    node("runner", ["judge"], { id: "patch_runner", required: true, canFallback: false, canSkip: true, produces: ["patch_apply"], consumes: ["judge_decision"] }),
    node("runner", ["patch_runner"], { id: "test_runner", required: true, canFallback: false, canSkip: true, produces: ["test_evidence"], consumes: ["patch_apply"] }),
    node("summarizer", ["test_runner"], { produces: ["summary"], consumes: ["patch_evidence", "review_evidence", "judge_decision", "patch_apply", "test_evidence"] })
  );
  return {
    workflowKind,
    nodes,
    stopConditions: ["judge_abort", "no_patch_candidate", "empty_diff", "budget_blocked_without_fallback"]
  };
}

function repairLoopGraph(): RoleGraph {
  return {
    workflowKind: "repair_loop",
    nodes: [
      node("runner", [], { produces: ["test_evidence"] }),
      node("repairer", ["runner"], { required: false, canSkip: true, produces: ["repair_patch"], consumes: ["test_evidence"] }),
      node("reviewer", ["repairer"], { required: false, canSkip: true, produces: ["review_evidence"], consumes: ["repair_patch"] }),
      node("runner", ["reviewer"], { id: "runner_after_repair", produces: ["test_evidence"], consumes: ["repair_patch"] })
    ],
    stopConditions: ["repeated_repair", "budget_blocked_without_fallback", "empty_diff"]
  };
}

function node(role: AgentRole, dependencies: string[], overrides: Partial<RoleNode> = {}): RoleNode {
  return {
    id: overrides.id ?? role,
    role,
    required: overrides.required ?? true,
    dependencies,
    canFallback: overrides.canFallback ?? true,
    canSkip: overrides.canSkip ?? false,
    maxRetries: overrides.maxRetries ?? 0,
    produces: overrides.produces ?? [],
    consumes: overrides.consumes ?? []
  };
}

function constrainRoleGraph(graph: RoleGraph, input: BuildRoleGraphInput, highRisk: boolean): RoleGraph {
  const readOnly = input.workflowKind === "read_only" || input.workflowKind === "advisory" || input.workflowKind === "ask_user";
  const allowedRoles = input.allowedRoles ? new Set(input.allowedRoles) : undefined;
  if (highRisk) {
    allowedRoles?.add("reviewer");
    allowedRoles?.add("judge");
  }
  if (readOnly) {
    for (const role of ["coder_a", "coder_b", "runner", "repairer"] as AgentRole[]) allowedRoles?.delete(role);
  }

  let nodes = graph.nodes.filter((item) => {
    if (readOnly && ["coder_a", "coder_b", "runner", "repairer"].includes(item.role)) return false;
    if (allowedRoles && !allowedRoles.has(item.role)) return false;
    return phaseAllowedForRole(item.role, input.allowedPhases, highRisk);
  });

  if (highRisk) {
    nodes = ensureGovernanceNodes(nodes, graph.workflowKind);
  }

  const nodeIds = new Set(nodes.map((item) => item.id));
  nodes = nodes.map((item) => ({
    ...item,
    dependencies: item.dependencies.filter((dependency) => nodeIds.has(dependency))
  }));
  return { ...graph, nodes };
}

function ensureGovernanceNodes(nodes: RoleNode[], workflowKind: RoleGraph["workflowKind"]): RoleNode[] {
  const next = [...nodes];
  if (!next.some((item) => item.role === "reviewer")) {
    next.push(node("reviewer", dependencyIfPresent(next, workflowKind === "read_only" || workflowKind === "advisory" ? "explorer" : "coder_a"), {
      required: true,
      produces: ["review_evidence"],
      consumes: ["plan", "context", "patch_candidate", "patch_evidence"]
    }));
  }
  if (!next.some((item) => item.role === "judge")) {
    next.push(node("judge", dependencyIfPresent(next, "reviewer"), {
      required: true,
      produces: ["judge_decision"],
      consumes: ["plan", "context", "review_evidence"]
    }));
  }
  return next;
}

function dependencyIfPresent(nodes: RoleNode[], roleOrId: string): string[] {
  return nodes.some((item) => item.id === roleOrId || item.role === roleOrId) ? [roleOrId] : [];
}

function phaseAllowedForRole(role: AgentRole, allowedPhases: EventPhase[] | undefined, highRisk: boolean): boolean {
  if (!allowedPhases) return true;
  if (highRisk && (role === "reviewer" || role === "judge")) return true;
  const phases = phasesForRole(role);
  return phases.some((phase) => allowedPhases.includes(phase));
}

function phasesForRole(role: AgentRole): EventPhase[] {
  if (role === "core" || role === "planner") return ["planning", "routing"];
  if (role === "vision") return ["vision"];
  if (role === "explorer") return ["exploration"];
  if (role === "coder_a" || role === "coder_b") return ["coding"];
  if (role === "reviewer") return ["review"];
  if (role === "judge") return ["judge"];
  if (role === "runner") return ["patch", "shell", "verification"];
  if (role === "repairer") return ["repair"];
  return ["summary"];
}
