import { makeId } from "../../utils/ids.js";
import type { TaskGraph } from "../planning/taskGraph.js";
import type { StrategyGenome } from "./strategyGenome.js";

export type MutationType =
  | "split_task"
  | "switch_owner_agent"
  | "retry_same_owner"
  | "add_reviewer"
  | "add_judge"
  | "increase_debate"
  | "trigger_council_replan"
  | "relax_cost"
  | "tighten_evidence"
  | "escalate_to_chief";

export type StrategyMutationTrigger =
  | "test_failed"
  | "review_blocked"
  | "judge_request_revision"
  | "budget_blocked"
  | "evidence_gap"
  | "agent_failure"
  | "timeout";

export type StrategyMutationEvent = {
  id: string;
  parentStrategyId: string;
  childStrategyId: string;
  type: MutationType;
  trigger: StrategyMutationTrigger;
  reason: string;
  affectedTaskNodeIds: string[];
  selected: boolean;
  requestedChange?: string;
  appliedChange?: string;
  changedOwner?: boolean;
  oldOwnerAgentId?: string;
  newOwnerAgentId?: string;
};

export type StrategySelectionDecision = {
  selectedStrategyId: string;
  candidates: Array<{
    strategyId: string;
    expectedCostDelta: number;
    expectedRiskDelta: number;
    expectedQualityDelta: number;
    reason: string;
  }>;
  selectionReason: string;
};

export function proposeStrategyMutations(input: {
  strategy: StrategyGenome;
  trigger: StrategyMutationTrigger;
  taskGraph: TaskGraph;
  affectedTaskNodeIds: string[];
  mutationCount: number;
  maxMutations?: number;
}): { mutations: StrategyMutationEvent[]; selectedStrategy: StrategyGenome; decision: StrategySelectionDecision } {
  const maxMutations = input.maxMutations ?? 2;
  if (input.mutationCount >= maxMutations) {
    const decision = {
      selectedStrategyId: input.strategy.id,
      candidates: [],
      selectionReason: `Mutation limit ${maxMutations} reached; keeping current strategy.`
    };
    return { mutations: [], selectedStrategy: input.strategy, decision };
  }
  const requestedMutationType = mutationTypeForTrigger(input.trigger);
  const affectedNodes = input.taskGraph.nodes.filter((node) => input.affectedTaskNodeIds.includes(node.id));
  const firstAffected = affectedNodes[0];
  const canSwitchOwner = affectedNodes.some((node) => (node.fallbackAgents ?? []).some((agentId) => agentId !== node.ownerAgentId));
  const mutationType: MutationType = requestedMutationType === "switch_owner_agent" && !canSwitchOwner
    ? "retry_same_owner"
    : requestedMutationType;
  const child = mutateStrategy(input.strategy, mutationType);
  const mutation: StrategyMutationEvent = {
    id: makeId("mutation"),
    parentStrategyId: input.strategy.id,
    childStrategyId: child.id,
    type: mutationType,
    trigger: input.trigger,
    reason: mutationReason(input.trigger, mutationType),
    affectedTaskNodeIds: input.affectedTaskNodeIds,
    selected: true,
    requestedChange: requestedMutationType === "switch_owner_agent"
      ? `switch owner for ${input.affectedTaskNodeIds.join(", ")}`
      : `${mutationType} for ${input.affectedTaskNodeIds.join(", ")}`,
    appliedChange: mutationType === "retry_same_owner"
      ? "no fallback owner available; retry same owner with tightened governance context"
      : "pending runtime application",
    changedOwner: false,
    oldOwnerAgentId: firstAffected?.ownerAgentId,
    newOwnerAgentId: mutationType === "retry_same_owner" ? firstAffected?.ownerAgentId : undefined
  };
  const decision: StrategySelectionDecision = {
    selectedStrategyId: child.id,
    candidates: [{
      strategyId: child.id,
      expectedCostDelta: child.budgetPolicy === "cheap_first" ? -0.25 : child.budgetPolicy === "strong_for_decisions" ? 0.15 : 0,
      expectedRiskDelta: child.reviewStrictness === "strict" ? -0.2 : 0,
      expectedQualityDelta: child.agentAssignmentStrategy === "quality_first" || child.reviewStrictness === "strict" ? 0.25 : 0.1,
      reason: mutation.reason
    }],
    selectionReason: "Selected bounded mutation that preserves Objective Contract and high-risk judge constraints."
  };
  return { mutations: [mutation], selectedStrategy: child, decision };
}

export function mutateTaskGraphForStrategy(taskGraph: TaskGraph, mutations: StrategyMutationEvent[]): TaskGraph {
  if (!mutations.length) return taskGraph;
  const tightenEvidence = mutations.some((mutation) => mutation.type === "tighten_evidence" || mutation.type === "add_reviewer" || mutation.type === "add_judge");
  return {
    ...taskGraph,
    nodes: taskGraph.nodes.map((node) => {
      if (!mutations.some((mutation) => mutation.affectedTaskNodeIds.includes(node.id))) return node;
      return {
        ...node,
        claimMode: "evolved",
        requiredEvidence: tightenEvidence ? [...new Set([...node.requiredEvidence, `${node.id}_mutation_evidence`])] : node.requiredEvidence,
        assignmentReason: node.assignmentReason ? `${node.assignmentReason}; evolved after ${mutations[0]?.trigger}` : `evolved after ${mutations[0]?.trigger}`
      };
    })
  };
}

function mutationTypeForTrigger(trigger: StrategyMutationTrigger): MutationType {
  switch (trigger) {
    case "test_failed":
      return "switch_owner_agent";
    case "review_blocked":
      return "add_judge";
    case "judge_request_revision":
      return "trigger_council_replan";
    case "budget_blocked":
      return "switch_owner_agent";
    case "evidence_gap":
      return "tighten_evidence";
    case "agent_failure":
      return "escalate_to_chief";
    case "timeout":
      return "split_task";
  }
}

function mutateStrategy(parent: StrategyGenome, mutationType: MutationType): StrategyGenome {
  const child: StrategyGenome = { ...parent, id: makeId("strategy") };
  switch (mutationType) {
    case "switch_owner_agent":
      child.agentAssignmentStrategy = parent.budgetPolicy === "cheap_first" ? "quality_first" : "cost_saver";
      child.budgetPolicy = parent.budgetPolicy === "cheap_first" ? "balanced" : "cheap_first";
      break;
    case "retry_same_owner":
      child.reviewStrictness = "strict";
      child.debateDepth = Math.min(3, parent.debateDepth + 1) as StrategyGenome["debateDepth"];
      break;
    case "add_judge":
    case "add_reviewer":
    case "tighten_evidence":
      child.reviewStrictness = "strict";
      child.debateDepth = Math.min(3, parent.debateDepth + 1) as StrategyGenome["debateDepth"];
      child.agentAssignmentStrategy = "risk_averse";
      break;
    case "trigger_council_replan":
      child.councilPolicy = "on_failure";
      child.repairPolicy = "replan";
      child.taskSplitStrategy = "fine";
      break;
    case "increase_debate":
      child.debateDepth = Math.min(3, parent.debateDepth + 1) as StrategyGenome["debateDepth"];
      break;
    case "split_task":
      child.taskSplitStrategy = "fine";
      break;
    case "relax_cost":
      child.budgetPolicy = "strong_for_decisions";
      break;
    case "escalate_to_chief":
      child.agentAssignmentStrategy = "chief_led";
      child.reviewStrictness = "strict";
      break;
  }
  return child;
}

function mutationReason(trigger: StrategyMutationTrigger, mutationType: MutationType): string {
  return `${trigger} triggered bounded ${mutationType}; mutation cannot change Objective Contract permissions or remove required high-risk judge.`;
}
