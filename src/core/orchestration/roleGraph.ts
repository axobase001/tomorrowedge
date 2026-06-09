import type { AgentRole } from "../../schemas/agentTask.js";
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

export function buildRoleGraph(input: { workflowKind: WorkflowKind; highRisk?: boolean; debate?: boolean; repairLoop?: boolean }): RoleGraph {
  if (input.repairLoop) return repairLoopGraph();
  if (input.workflowKind === "read_only" || input.workflowKind === "advisory") return readOnlyGraph(input.workflowKind);
  if (input.highRisk) return patchGraph("high_risk_patch", true, true);
  if (input.debate) return patchGraph("debate_patch", false, true);
  if (input.workflowKind === "vision_patch") return patchGraph("vision_patch", false, false);
  if (input.workflowKind === "ask_user") {
    return {
      workflowKind: "ask_user",
      nodes: [node("planner", [], { required: true, produces: ["clarifying_question"] })],
      stopConditions: ["budget_blocked_without_fallback"]
    };
  }
  return patchGraph("patch", false, false);
}

export function optionalNodeCanSkip(graph: RoleGraph, nodeId: string): boolean {
  const found = graph.nodes.find((nodeItem) => nodeItem.id === nodeId);
  return Boolean(found && !found.required && found.canSkip);
}

function readOnlyGraph(workflowKind: "read_only" | "advisory"): RoleGraph {
  return {
    workflowKind,
    nodes: [
      node("planner", [], { produces: ["plan"] }),
      node("explorer", ["planner"], { produces: ["context"], consumes: ["plan"] }),
      node("summarizer", ["explorer"], { produces: ["summary"], consumes: ["plan", "context"] })
    ],
    stopConditions: ["read_only_complete", "budget_blocked_without_fallback"]
  };
}

function patchGraph(workflowKind: RoleGraph["workflowKind"], highRisk: boolean, debate: boolean): RoleGraph {
  const nodes: RoleNode[] = [
    node("planner", [], { produces: ["plan"] }),
    node("explorer", ["planner"], { produces: ["context"], consumes: ["plan"] }),
    node("coder_a", ["explorer"], { produces: ["patch_candidate", "patch_evidence"], consumes: ["plan", "context"] })
  ];
  if (debate || highRisk) nodes.push(node("coder_b", ["explorer"], { required: false, canSkip: true, produces: ["patch_candidate", "patch_evidence"], consumes: ["plan", "context"] }));
  nodes.push(
    node("reviewer", debate || highRisk ? ["coder_a", "coder_b"] : ["coder_a"], { required: highRisk, produces: ["review_evidence"], consumes: ["patch_candidate", "patch_evidence"] }),
    node("judge", ["reviewer"], { required: true, produces: ["judge_decision"], consumes: ["patch_candidate", "patch_evidence", "review_evidence"] }),
    node("runner", ["judge"], { required: true, canFallback: false, produces: ["patch_apply", "test_evidence"], consumes: ["judge_decision"] }),
    node("summarizer", ["runner"], { produces: ["summary"], consumes: ["patch_evidence", "review_evidence", "judge_decision", "test_evidence"] })
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
