import type { AgentRuntimeProfile } from "../agents/capabilityProfile.js";
import { scoreAgentForRole } from "../agents/defaultCapabilityProfiles.js";
import type { CouncilSession, TaskAssignmentProposal } from "../council/councilTypes.js";
import type { StrategyGenome } from "../evolution/strategyGenome.js";
import type { TaskGraph, TaskGraphNode } from "../planning/taskGraph.js";

export type BudgetPolicy = {
  hardCapUsd?: number;
  preferCheap?: boolean;
};

export function assignTaskOwners(input: {
  taskGraph: TaskGraph;
  councilSession?: CouncilSession;
  availableAgents: AgentRuntimeProfile[];
  budgetPolicy: BudgetPolicy;
  strategyGenome?: StrategyGenome;
}): TaskGraph {
  const proposals = new Map<string, TaskAssignmentProposal>();
  for (const proposal of input.councilSession?.proposals ?? []) {
    for (const assignment of proposal.suggestedAssignments) {
      if (!proposals.has(assignment.taskNodeId)) proposals.set(assignment.taskNodeId, assignment);
    }
  }
  for (const move of input.councilSession?.moves ?? []) {
    for (const assignment of move.structuredPayload?.assignmentSuggestions ?? []) {
      if (!proposals.has(assignment.taskNodeId)) proposals.set(assignment.taskNodeId, assignment);
    }
  }

  return {
    ...input.taskGraph,
    nodes: input.taskGraph.nodes.map((node) => {
      const proposal = proposals.get(node.id);
      const proposedAgent = proposal ? input.availableAgents.find((agent) => agent.agentId === proposal.ownerAgentId) : undefined;
      const selected = proposedAgent ?? selectOwner(node, input.availableAgents, input.budgetPolicy, input.strategyGenome);
      const fallbackAgents = input.availableAgents
        .filter((agent) => agent.agentId !== selected.agentId && agent.allowedRoles.includes(node.ownerRole))
        .sort((a, b) => scoreAgentForRole(b, node.ownerRole, node.riskLevel) - scoreAgentForRole(a, node.ownerRole, node.riskLevel))
        .slice(0, 2)
        .map((agent) => agent.agentId);
      const reason = proposal?.reason ?? assignmentReason(node, selected, input.strategyGenome, input.budgetPolicy);
      return {
        ...node,
        ownerAgentId: selected.agentId,
        assignedProvider: selected.provider,
        assignedModel: selected.model,
        assignmentReason: reason,
        claimMode: proposal?.claimMode ?? "assigned",
        fallbackAgents
      };
    })
  };
}

export function selectOwner(
  node: TaskGraphNode,
  availableAgents: AgentRuntimeProfile[],
  budgetPolicy: BudgetPolicy,
  strategyGenome?: StrategyGenome
): AgentRuntimeProfile {
  const candidates = availableAgents.filter((agent) => agent.allowedRoles.includes(node.ownerRole));
  if (!candidates.length) {
    throw new Error(`No AgentCapabilityProfile can own role ${node.ownerRole} for task node ${node.id}. Sirius does not silently reassign to an unqualified agent.`);
  }
  const highRiskDecision = node.riskLevel === "high" && (node.kind === "review" || node.kind === "judge" || node.ownerRole === "reviewer" || node.ownerRole === "judge");
  const cheapBias = budgetPolicy.preferCheap || strategyGenome?.budgetPolicy === "cheap_first";
  const qualityBias = strategyGenome?.agentAssignmentStrategy === "quality_first" || strategyGenome?.budgetPolicy === "strong_for_decisions";
  return [...candidates].sort((a, b) => {
    const aScore = assignmentScore(a, node, { cheapBias, qualityBias, highRiskDecision });
    const bScore = assignmentScore(b, node, { cheapBias, qualityBias, highRiskDecision });
    return bScore - aScore;
  })[0]!;
}

function assignmentScore(
  agent: AgentRuntimeProfile,
  node: TaskGraphNode,
  context: { cheapBias: boolean; qualityBias: boolean; highRiskDecision: boolean }
): number {
  let score = scoreAgentForRole(agent, node.ownerRole, node.riskLevel);
  if (context.highRiskDecision && agent.capabilities.costTier === "expensive") score += 0.2;
  if (context.qualityBias && (node.kind === "review" || node.kind === "judge" || node.riskLevel === "high")) score += agent.capabilities.reliabilityScore * 0.25;
  if (context.cheapBias && node.riskLevel !== "high" && agent.capabilities.costTier === "cheap") score += 0.18;
  if (context.cheapBias && node.riskLevel === "low" && agent.capabilities.costTier === "expensive") score -= 0.3;
  return score;
}

function assignmentReason(node: TaskGraphNode, agent: AgentRuntimeProfile, strategyGenome: StrategyGenome | undefined, budgetPolicy: BudgetPolicy): string {
  const parts = [
    `capability score matched ${node.ownerRole}/${node.kind}`,
    `risk=${node.riskLevel}`,
    `costTier=${agent.capabilities.costTier}`
  ];
  if (strategyGenome) parts.push(`strategy=${strategyGenome.agentAssignmentStrategy}/${strategyGenome.budgetPolicy}`);
  if (budgetPolicy.preferCheap) parts.push("budget prefers cheap execution where risk allows");
  if (node.riskLevel === "high" && (node.kind === "review" || node.kind === "judge")) parts.push("high-risk decision task reserves stronger reviewer/judge");
  return parts.join("; ");
}
