import type { AgentRole } from "../../schemas/agentTask.js";
import type { RiskLevel } from "../../schemas/plan.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";

export type TaskGraphNodeStatus = "pending" | "running" | "done" | "blocked" | "skipped";

export type TaskNodeKind =
  | "inspect"
  | "analyze"
  | "design"
  | "patch"
  | "review"
  | "judge"
  | "apply_patch"
  | "verify"
  | "repair"
  | "summarize"
  | "ask_user";

export type EvidenceRequirement = {
  id: string;
  kind: "file" | "diff" | "review" | "judge" | "shell" | "artifact" | "reasoning";
  description: string;
  required: boolean;
};

export type ExpectedOutput = {
  id: string;
  kind: "context" | "plan" | "patch" | "review" | "judgment" | "test_result" | "summary" | "artifact";
  description: string;
};

export type TaskGraphNode = {
  id: string;
  kind: TaskNodeKind;
  title: string;
  objective: string;
  detail: string;
  phase: EventPhase;
  ownerRole: AgentRole;
  roleHints: AgentRole[];
  dependsOn: string[];
  dependencies: string[];
  requiredInputs: EvidenceRequirement[];
  expectedOutputs: ExpectedOutput[];
  requiredEvidence: string[];
  expectedArtifacts: string[];
  evidenceRefs?: string[];
  artifactRefs?: string[];
  files?: string[];
  riskLevel: RiskLevel;
  mutationAllowed: boolean;
  canRunInParallel: boolean;
  stopIfFails: boolean;
  fallbackRole?: AgentRole;
  acceptanceCriteria: string[];
  status: TaskGraphNodeStatus;
};

export type TaskGraphEdge = {
  from: string;
  to: string;
  reason: string;
};

export type TaskGraph = {
  schemaVersion: "task-graph/v1";
  graphId: string;
  goal: string;
  rootObjective: string;
  workflowKind?: WorkflowKind;
  riskLevel: RiskLevel;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
  stopConditions: string[];
  riskBoundaries: string[];
};
