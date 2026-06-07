import type { AccessMode } from "../config/schema.js";
import type { AgentRole } from "../schemas/agentTask.js";
import type { TomorrowEdgeEvent } from "../core/events/eventTypes.js";

export type CockpitWorkflowStage =
  | "idle"
  | "planning"
  | "routing"
  | "editing"
  | "reviewing"
  | "testing"
  | "waiting_approval"
  | "done"
  | "failed";

export type CockpitTaskSummary = {
  id: string;
  title: string;
  status: "running" | "waiting" | "done" | "failed";
  updatedAt: string;
  reminder: string;
  selected?: boolean;
};

export type CockpitWorkflowStep = {
  id: string;
  label: "Plan" | "Route" | "Edit" | "Review" | "Test" | "Judge" | "Approve";
  status: "pending" | "running" | "done" | "waiting" | "failed";
  summary: string;
  meta?: string;
};

export type CockpitAgentSummary = {
  role: AgentRole;
  provider: string;
  model: string;
  status: string;
  agentKind?: "offline" | "live" | "external";
  elapsedMs?: number;
};

export type CockpitRouteSummary = {
  role: AgentRole;
  provider: string;
  model: string;
  reason: string;
};

export type CockpitTelemetry = {
  plannerModel?: string;
  coderModel?: string;
  reviewerModel?: string;
  judgeModel?: string;
  providerSummary: string;
  currentCostUsd?: number;
  budgetUsd?: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitPercent?: number;
  latencyMs?: number;
  dispatched: number;
  running: number;
  completed: number;
  waiting: number;
  failed: number;
  patchWaiting: boolean;
  shellWaiting: boolean;
  latestRiskLevel?: "low" | "medium" | "high";
  decisionConfidence?: number;
  fallbackCount: number;
};

export type CockpitSessionSource = "empty" | "saved" | "live" | "api_unavailable";
export type CockpitConnectionState = "idle" | "connected" | "disconnected" | "reconnecting" | "unavailable";

export type CockpitSessionMeta = {
  source: CockpitSessionSource;
  sourceLabel: string;
  connectionState: CockpitConnectionState;
  connectionLabel: string;
  fixtureMode: boolean;
  stale: boolean;
  reconnectAttempts: number;
  message?: string;
};

export type CockpitApproval = {
  id: string;
  kind: "patch" | "shell" | "repair" | "review";
  title: string;
  status: "waiting" | "approved" | "rejected" | "revision_requested";
  candidateId?: string;
  command?: string;
  filesChanged: string[];
  riskLevel?: "low" | "medium" | "high";
  testStatus?: "passed" | "failed" | "not_run";
  summary: string;
  diff?: string;
};

export type CockpitApprovalHistoryItem = {
  id: string;
  approvalId: string;
  kind: CockpitApproval["kind"];
  status: CockpitApproval["status"];
  action: "waiting" | "approved" | "rejected" | "revision_requested" | "undone";
  actor: string;
  source: string;
  timestamp: string;
  title: string;
  summary: string;
  blocksProgress: boolean;
  filterTags: Array<"patch" | "shell" | "pending" | "completed" | "rejected" | "undo" | "review">;
  candidateId?: string;
  command?: string;
  filesChanged: string[];
  diffRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  durationMs?: number;
  undoSnapshotIds?: string[];
};

export type CockpitTraceItem = {
  id: string;
  timestamp: string;
  type: string;
  phase: string;
  role?: AgentRole;
  summary: string;
};

export type CockpitViewModel = {
  version: "1";
  sessionId?: string;
  goal: string;
  workspace: string;
  accessMode: AccessMode | "fixture" | "local";
  sessionMeta: CockpitSessionMeta;
  status: CockpitWorkflowStage;
  statusText: string;
  tasks: CockpitTaskSummary[];
  workflow: CockpitWorkflowStep[];
  agents: CockpitAgentSummary[];
  routes: CockpitRouteSummary[];
  telemetry: CockpitTelemetry;
  approvals: CockpitApproval[];
  approvalHistory: CockpitApprovalHistoryItem[];
  currentApproval?: CockpitApproval;
  main: {
    title: string;
    subtitle: string;
    body: string;
    diff?: string;
    filesChanged: string[];
    riskLevel?: "low" | "medium" | "high";
    testStatus?: "passed" | "failed" | "not_run";
  };
  trace: CockpitTraceItem[];
  rawEvents: TomorrowEdgeEvent[];
  artifacts: Array<{ ref: string; kind: string }>;
};

export type CockpitRunRequest = {
  goal?: string;
  accessMode?: AccessMode;
  fixtureMode?: boolean;
  approvePatch?: boolean;
  approveShell?: boolean;
  approveRepair?: boolean;
  repairOnFail?: boolean;
  to?: string;
};

export type CockpitApprovalIntent = {
  action: "approve_patch" | "reject_patch" | "approve_shell" | "reject_shell" | "request_re_review" | "undo_latest_patch";
  sessionId: string;
  approvalId?: string;
  feedback?: string;
};
