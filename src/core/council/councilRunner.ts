import type { AgentRuntimeProfile } from "../agents/capabilityProfile.js";
import { scoreAgentForRole } from "../agents/defaultCapabilityProfiles.js";
import type { ChiefAgentProfile } from "../chiefAgent/chiefAgentTypes.js";
import { makeId } from "../../utils/ids.js";
import type { Plan, RiskLevel, TaskType } from "../../schemas/plan.js";
import type { TaskGraph, TaskGraphNode, TaskNodeKind } from "../planning/taskGraph.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { CouncilMember, CouncilMove, CouncilProposal, CouncilSession, CouncilStructuredPayload, TaskAssignmentProposal } from "./councilTypes.js";

export async function runAgentCouncil(input: {
  goal: string;
  chiefAgent: ChiefAgentProfile;
  availableAgents: AgentRuntimeProfile[];
  riskLevel?: RiskLevel;
}): Promise<CouncilSession> {
  const riskLevel = input.riskLevel ?? "high";
  const sessionId = makeId("council");
  const members = selectCouncilMembers(input.chiefAgent, input.availableAgents, riskLevel);
  const graphId = makeId("task_graph");
  const nodes = buildConsensusNodes(input.goal, graphId, riskLevel);
  const moves: CouncilMove[] = [];
  const proposals: CouncilProposal[] = [];

  const initialMove: CouncilMove = {
    id: makeId("move"),
    round: 0,
    type: "initial_proposal",
    speakerAgentId: input.chiefAgent.id,
    summary: `Chief proposes a governed rewrite plan for: ${input.goal}`,
    structuredPayload: emptyPayload({
      taskGraphChanges: nodes.map((node) => `create:${node.id}`),
      acceptanceCriteriaChanges: ["All core tasks require owner assignment, evidence refs, and final chief review."]
    })
  };
  moves.push(initialMove);

  const implementer = members.find((member) => member.assignedCouncilRole === "implementer") ?? members[0];
  if (implementer) {
    const payload = emptyPayload({
      critique: ["Implementation tasks need explicit boundaries so generated code and test plan do not drift."],
      missingRequirements: ["Define CLI entrypoint, parity behavior, and verification command before implementation."],
      riskSignals: ["Rust rewrite can miss JS CLI behavior if tests are too shallow."],
      assignmentSuggestions: [{
        taskNodeId: "rust_cli_structure",
        ownerAgentId: implementer.agentId,
        role: "coder_a",
        taskKind: "patch",
        reason: "Highest implementation capability among council members.",
        claimMode: "volunteered"
      }]
    });
    moves.push({
      id: makeId("move"),
      round: 1,
      type: "critique",
      speakerAgentId: implementer.agentId,
      targetMoveId: initialMove.id,
      summary: "Implementation critique adds boundaries and claims Rust structure work.",
      structuredPayload: payload
    });
    proposals.push(moveToProposal(implementer.agentId, payload, "Implementation feasibility critique"));
  }

  const testPlanner = members.find((member) => member.assignedCouncilRole === "test_planner" || member.assignedCouncilRole === "cost_optimizer")
    ?? members.find((member) => member.agentId !== implementer?.agentId);
  if (testPlanner) {
    const payload = emptyPayload({
      gapFill: true,
      missingRequirements: ["Add cheap verification and documentation handoff before final review."],
      taskGraphChanges: ["add:test_plan", "add:final_review"],
      assignmentSuggestions: [{
        taskNodeId: "test_plan",
        ownerAgentId: testPlanner.agentId,
        role: "runner",
        taskKind: "verify",
        reason: "Cost-efficient test planning and validation coverage.",
        claimMode: "volunteered"
      }]
    });
    moves.push({
      id: makeId("move"),
      round: 1,
      type: "gap_fill",
      speakerAgentId: testPlanner.agentId,
      targetMoveId: initialMove.id,
      summary: "Gap fill adds cheaper test/doc planning before chief final review.",
      structuredPayload: payload
    });
    proposals.push(moveToProposal(testPlanner.agentId, payload, "Cheap verification gap fill"));
  }

  const taskGraph = buildTaskGraph(input.goal, graphId, riskLevel, nodes);
  const consensusPlan: Plan = {
    goal: input.goal,
    constraints: ["Use replaceable council agents", "Record evidence and task ownership", "Return to chief for final review"],
    riskLevel,
    taskType: inferTaskType(input.goal),
    workflowKind: "patch",
    requiresPatchWorkflow: true,
    acceptanceCriteria: ["Consensus TaskGraph has concrete owners", "At least two agents own delegated tasks", "Final chief review approves delivery"],
    steps: nodes.map((node) => ({ id: node.id, title: node.title, detail: node.detail, status: "pending" })),
    taskGraph,
    expectedFiles: ["src/main.rs", "Cargo.toml"],
    verificationCommands: ["cargo test"],
    debateRecommended: true,
    reasonForDebate: "Council governance runtime requires structured critique and final chief review."
  };

  moves.push({
    id: makeId("move"),
    round: 2,
    type: "consensus_revision",
    speakerAgentId: input.chiefAgent.id,
    summary: "Chief integrates council critique and gap fill into consensus TaskGraph.",
    structuredPayload: emptyPayload({
      taskGraphChanges: taskGraph.nodes.map((node) => `consensus:${node.id}`),
      assignmentSuggestions: [
        ...proposals.flatMap((proposal) => proposal.suggestedAssignments),
        { taskNodeId: "architecture_plan", ownerAgentId: input.chiefAgent.id, role: "planner", taskKind: "design", reason: "Chief owns architecture planning.", claimMode: "assigned" },
        { taskNodeId: "final_review", ownerAgentId: input.chiefAgent.id, role: "judge", taskKind: "judge", reason: "Chief must perform final review and judge.", claimMode: "assigned" }
      ]
    })
  });
  moves.push({
    id: makeId("move"),
    round: 2,
    type: "final_consensus",
    speakerAgentId: input.chiefAgent.id,
    summary: `Consensus accepted with ${taskGraph.nodes.length} task nodes and ${members.length} council members.`,
    structuredPayload: emptyPayload()
  });

  return {
    schemaVersion: "council/v1",
    sessionId,
    chiefAgentId: input.chiefAgent.id,
    members,
    moves,
    proposals,
    consensusPlan,
    consensusTaskGraph: taskGraph,
    unresolvedRisks: [],
    status: "consensus"
  };
}

export function selectCouncilMembers(chiefAgent: ChiefAgentProfile, availableAgents: AgentRuntimeProfile[], riskLevel: RiskLevel): CouncilMember[] {
  const candidates = availableAgents.filter((agent) => agent.agentId !== chiefAgent.id);
  const implementer = bestFor(candidates, "coder_a", riskLevel);
  const testPlanner = bestFor(candidates.filter((agent) => agent.agentId !== implementer?.agentId), "test_planner", riskLevel);
  const reviewer = bestFor(candidates.filter((agent) => agent.agentId !== implementer?.agentId && agent.agentId !== testPlanner?.agentId), "reviewer", riskLevel);
  const selected = [
    implementer && member(implementer, "implementer"),
    testPlanner && member(testPlanner, testPlanner.capabilities.costTier === "cheap" ? "cost_optimizer" : "test_planner"),
    reviewer && member(reviewer, "risk_checker")
  ].filter((item): item is CouncilMember => Boolean(item));
  return selected.length ? selected : [member({
    agentId: "mock-council-member",
    provider: "mock",
    model: "mock-balanced",
    capabilities: chiefAgent.capabilities,
    allowedRoles: ["reviewer"],
    trustLevel: "medium"
  }, "reviewer")];
}

function buildConsensusNodes(goal: string, graphId: string, riskLevel: RiskLevel): TaskGraphNode[] {
  return [
    node("architecture_plan", "design", "Architecture plan", `Chief architecture plan for ${goal}`, "planning", "planner", [], riskLevel),
    node("rust_cli_structure", "patch", "Rust CLI structure", "Create the Rust CLI module structure and implementation plan.", "coding", "coder_a", ["architecture_plan"], "medium"),
    node("test_plan", "verify", "Verification and parity plan", "Define cargo test/parity checks and documentation handoff.", "verification", "runner", ["rust_cli_structure"], "medium"),
    node("risk_review", "review", "Risk review", "Review delegated implementation and evidence before chief judge.", "review", "reviewer", ["rust_cli_structure", "test_plan"], riskLevel),
    node("final_review", "judge", "Chief final review", "Chief reviews evidence, risks, and deliverable before release.", "judge", "judge", ["risk_review"], riskLevel)
  ].map((item) => ({ ...item, detail: `${item.detail} graph=${graphId}` }));
}

function buildTaskGraph(goal: string, graphId: string, riskLevel: RiskLevel, nodes: TaskGraphNode[]): TaskGraph {
  return {
    schemaVersion: "task-graph/v1",
    graphId,
    goal,
    rootObjective: goal,
    workflowKind: "patch",
    riskLevel,
    nodes,
    edges: nodes.flatMap((task) => task.dependsOn.map((dependency) => ({ from: dependency, to: task.id, reason: "Council consensus dependency" }))),
    entryNodeIds: ["architecture_plan"],
    terminalNodeIds: ["final_review"],
    stopConditions: ["final chief review requests revision", "objective contract violation", "budget blocked without mutation"],
    riskBoundaries: ["Do not bypass Objective Contract", "Do not remove high-risk review/judge", "Do not apply patch without access-mode permission"]
  };
}

function node(id: string, kind: TaskNodeKind, title: string, detail: string, phase: TaskGraphNode["phase"], ownerRole: AgentRole, dependsOn: string[], riskLevel: RiskLevel): TaskGraphNode {
  return {
    id,
    kind,
    title,
    objective: title,
    detail,
    phase,
    ownerRole,
    roleHints: [ownerRole],
    dependsOn,
    dependencies: dependsOn,
    requiredInputs: dependsOn.map((dependency) => ({ id: `${dependency}_output`, kind: "artifact", description: `Output from ${dependency}`, required: true })),
    expectedOutputs: [{ id: `${id}_output`, kind: kind === "judge" ? "judgment" : kind === "review" ? "review" : kind === "verify" ? "test_result" : "artifact", description: `${title} output` }],
    requiredEvidence: [`${id}_evidence`],
    expectedArtifacts: [`${id}_artifact`],
    evidenceRefs: [],
    artifactRefs: [],
    riskLevel,
    mutationAllowed: kind !== "judge",
    canRunInParallel: kind === "patch" || kind === "verify",
    stopIfFails: kind === "judge" || riskLevel === "high",
    acceptanceCriteria: [`${title} is supported by evidence and artifact refs.`],
    status: "pending"
  };
}

function bestFor(candidates: AgentRuntimeProfile[], role: AgentRole | "test_planner", risk: RiskLevel): AgentRuntimeProfile | undefined {
  return [...candidates].sort((a, b) => scoreAgentForRole(b, role, risk) - scoreAgentForRole(a, role, risk))[0];
}

function member(agent: AgentRuntimeProfile, assignedCouncilRole: CouncilMember["assignedCouncilRole"]): CouncilMember {
  return {
    agentId: agent.agentId,
    provider: agent.provider,
    model: agent.model,
    capabilities: agent.capabilities,
    assignedCouncilRole
  };
}

function emptyPayload(partial: Partial<CouncilStructuredPayload> & { gapFill?: boolean } = {}): CouncilStructuredPayload {
  return {
    critique: partial.critique ?? [],
    missingRequirements: partial.missingRequirements ?? [],
    riskSignals: partial.riskSignals ?? [],
    taskGraphChanges: partial.taskGraphChanges ?? [],
    assignmentSuggestions: partial.assignmentSuggestions ?? [],
    acceptanceCriteriaChanges: partial.acceptanceCriteriaChanges ?? []
  };
}

function moveToProposal(agentId: string, payload: CouncilStructuredPayload, summary: string): CouncilProposal {
  return {
    id: makeId("proposal"),
    proposedBy: agentId,
    summary,
    risks: payload.riskSignals,
    missingInfo: payload.missingRequirements,
    suggestedAssignments: payload.assignmentSuggestions
  };
}

function inferTaskType(goal: string): TaskType {
  if (/rewrite|rebuild|refactor|migration|migrate/i.test(goal)) return "refactor";
  if (/test|verify/i.test(goal)) return "test";
  if (/doc|readme/i.test(goal)) return "docs";
  if (/bug|fix|repair/i.test(goal)) return "bugfix";
  return "feature";
}
