import type { AgentGraphState } from "../agentGraph/state.js";
import type { CouncilSession } from "./councilTypes.js";
import type { StrategyGenome } from "../evolution/strategyGenome.js";
import { makeId } from "../../utils/ids.js";

export type FailureSignal = {
  trigger: "test_failed" | "review_blocked" | "judge_request_revision" | "budget_blocked" | "evidence_gap" | "agent_failure" | "timeout";
  reason: string;
  taskNodeIds: string[];
  repeated?: boolean;
};

export async function maybeTriggerCouncilReplan(input: {
  state: AgentGraphState;
  failureSignal: FailureSignal;
  currentStrategy: StrategyGenome;
}): Promise<CouncilSession | undefined> {
  const highRisk = input.state.plan?.taskGraph?.riskLevel === "high" || input.state.objectiveContract?.riskLevel === "high";
  const largeTask = (input.state.plan?.taskGraph?.nodes.length ?? 0) >= 4;
  if (!highRisk && !largeTask && !input.failureSignal.repeated) return undefined;
  if (input.state.events.some((event) => event.type === "council_replan")) return undefined;
  const currentGraph = input.state.plan?.taskGraph;
  if (!currentGraph) return undefined;
  const replanNodeIds = new Set(input.failureSignal.taskNodeIds);
  const nextGraph = {
    ...currentGraph,
    graphId: makeId("task_graph"),
    nodes: currentGraph.nodes.map((node) => replanNodeIds.has(node.id)
      ? {
          ...node,
          id: `${node.id}_replanned`,
          title: `${node.title} (replanned)`,
          detail: `${node.detail} Replanned because ${input.failureSignal.reason}`,
          dependsOn: node.dependsOn,
          dependencies: node.dependencies,
          claimMode: "evolved" as const,
          status: "pending" as const
        }
      : node),
    edges: currentGraph.edges.map((edge) => ({
      ...edge,
      from: replanNodeIds.has(edge.from) ? `${edge.from}_replanned` : edge.from,
      to: replanNodeIds.has(edge.to) ? `${edge.to}_replanned` : edge.to,
      reason: `${edge.reason}; council replan`
    })),
    terminalNodeIds: currentGraph.terminalNodeIds.map((id) => replanNodeIds.has(id) ? `${id}_replanned` : id)
  };
  return {
    schemaVersion: "council/v1",
    sessionId: makeId("council_replan"),
    chiefAgentId: input.state.council?.chiefAgentId ?? input.state.chiefAgent?.id ?? "chief",
    members: input.state.council?.members ?? [],
    moves: [{
      id: makeId("move"),
      round: 0,
      type: "consensus_revision",
      speakerAgentId: input.state.council?.chiefAgentId ?? input.state.chiefAgent?.id ?? "chief",
      summary: `Council replan patches TaskGraph after ${input.failureSignal.trigger}: ${input.failureSignal.reason}`,
      structuredPayload: {
        critique: [],
        missingRequirements: [],
        riskSignals: [input.failureSignal.reason],
        taskGraphChanges: input.failureSignal.taskNodeIds.map((id) => `replan:${id}`),
        assignmentSuggestions: [],
        acceptanceCriteriaChanges: ["Replanned nodes must preserve original Objective Contract."]
      }
    }],
    proposals: [],
    consensusPlan: input.state.plan ? { ...input.state.plan, taskGraph: nextGraph } : undefined,
    consensusTaskGraph: nextGraph,
    unresolvedRisks: [],
    status: "consensus"
  };
}
