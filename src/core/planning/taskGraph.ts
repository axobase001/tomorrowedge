import type { AgentRole } from "../../schemas/agentTask.js";
import type { RiskLevel } from "../../schemas/plan.js";
import type { EventPhase } from "../events/eventTypes.js";
import type { WorkflowKind } from "../orchestration/workflowKind.js";

export type TaskGraphNodeStatus = "pending" | "running" | "done" | "blocked" | "skipped";

export type TaskGraphNode = {
  id: string;
  title: string;
  detail: string;
  phase: EventPhase;
  roleHints: AgentRole[];
  dependencies: string[];
  requiredEvidence: string[];
  expectedArtifacts: string[];
  status: TaskGraphNodeStatus;
};

export type TaskGraphEdge = {
  from: string;
  to: string;
  reason: string;
};

export type TaskGraph = {
  graphId: string;
  goal: string;
  workflowKind?: WorkflowKind;
  riskLevel: RiskLevel;
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
};
