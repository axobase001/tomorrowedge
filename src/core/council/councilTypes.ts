import type { AgentCapabilityProfile } from "../agents/capabilityProfile.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import type { Plan } from "../../schemas/plan.js";
import type { TaskGraph, TaskNodeKind } from "../planning/taskGraph.js";

export type CouncilMoveType =
  | "initial_proposal"
  | "critique"
  | "gap_fill"
  | "alternative_plan"
  | "task_claim"
  | "risk_objection"
  | "consensus_revision"
  | "final_consensus";

export type CouncilMemberRole =
  | "architect"
  | "implementer"
  | "reviewer"
  | "cost_optimizer"
  | "risk_checker"
  | "test_planner";

export type CouncilMember = {
  agentId: string;
  provider: string;
  model?: string;
  capabilities: AgentCapabilityProfile;
  assignedCouncilRole: CouncilMemberRole;
};

export type CouncilStructuredPayload = {
  critique: string[];
  missingRequirements: string[];
  riskSignals: string[];
  taskGraphChanges: string[];
  assignmentSuggestions: TaskAssignmentProposal[];
  acceptanceCriteriaChanges: string[];
};

export type CouncilMove = {
  id: string;
  round: number;
  type: CouncilMoveType;
  speakerAgentId: string;
  targetMoveId?: string;
  summary: string;
  structuredPayload?: CouncilStructuredPayload;
  evidenceRefs?: string[];
};

export type TaskAssignmentProposal = {
  taskNodeId: string;
  ownerAgentId: string;
  role: AgentRole;
  taskKind: TaskNodeKind;
  reason: string;
  claimMode: "assigned" | "volunteered" | "evolved";
};

export type CouncilProposal = {
  id: string;
  proposedBy: string;
  summary: string;
  taskGraphPatch?: Partial<TaskGraph>;
  risks: string[];
  missingInfo: string[];
  suggestedAssignments: TaskAssignmentProposal[];
};

export type CouncilSession = {
  schemaVersion: "council/v1";
  sessionId: string;
  chiefAgentId: string;
  members: CouncilMember[];
  moves: CouncilMove[];
  proposals: CouncilProposal[];
  consensusPlan?: Plan;
  consensusTaskGraph?: TaskGraph;
  unresolvedRisks: string[];
  status: "running" | "consensus" | "ask_user" | "aborted";
};
