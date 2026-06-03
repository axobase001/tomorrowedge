import type { AccessMode } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";

export type EventPhase =
  | "planning"
  | "vision"
  | "exploration"
  | "coding"
  | "review"
  | "judge"
  | "patch"
  | "shell"
  | "repair"
  | "verification"
  | "summary"
  | "routing"
  | "memory";

export type BaseEvent = {
  id: string;
  timestamp: string;
  sessionId: string;
  role?: AgentRole;
  provider?: string;
  model?: string;
  mode: AccessMode;
  phase: EventPhase;
};

export type ModelCallEvent = BaseEvent & {
  type: "model_call";
  status?: "start" | "success" | "failure";
  requestId: string;
  promptRef?: string;
  responseRef?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  fallbackUsed?: boolean;
  fallbackFrom?: string;
  error?: string;
};

export type ContextSelectEvent = BaseEvent & {
  type: "context_select";
  selectedFiles: string[];
  excludedFiles: string[];
  summary: string;
};

export type FileReadEvent = BaseEvent & {
  type: "file_read";
  path: string;
  reason: string;
  risk?: string;
};

export type PatchCandidateEvent = BaseEvent & {
  type: "patch_candidate";
  candidateId: string;
  approach: string;
  summary: string;
  filesChanged: string[];
  diffRef?: string;
  estimatedRisk: "low" | "medium" | "high";
};

export type ReviewEvent = BaseEvent & {
  type: "review_decision";
  reviewRef: string;
  recommendation: string;
};

export type JudgeEvent = BaseEvent & {
  type: "judge_decision";
  decision: string;
  selectedCandidateId?: string;
  reason: string;
  confidence: number;
  decisionRef: string;
};

export type PatchApplyEvent = BaseEvent & {
  type: "patch_apply";
  candidateId: string;
  filesChanged: string[];
  diffRef: string;
  undoSnapshotIds: string[];
  applied: boolean;
  error?: string;
};

export type ShellRunEvent = BaseEvent & {
  type: "shell_run";
  command: string;
  cwd: string;
  exitCode?: number;
  stdoutRef?: string;
  stderrRef?: string;
  durationMs?: number;
  success?: boolean;
  error?: string;
};

export type RepairEvent = BaseEvent & {
  type: "repair_attempt";
  candidateId: string;
  filesChanged: string[];
  diffRef?: string;
  applied?: boolean;
  error?: string;
};

export type ProviderFallbackEvent = BaseEvent & {
  type: "provider_fallback";
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reason: string;
  error?: string;
};

export type CostUsageEvent = BaseEvent & {
  type: "cost_usage";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  byProvider?: Record<string, { inputTokens: number; outputTokens: number; estimatedCostUsd?: number }>;
};

export type EvidenceEvent = BaseEvent & {
  type: "evidence_update";
  evidence: string[];
  evidenceRef?: string;
};

export type SummaryEvent = BaseEvent & {
  type: "summary";
  summaryRef: string;
  result: string;
};

export type AccessModeEvent = BaseEvent & {
  type: "access_mode";
  accessMode: AccessMode;
  cloudAllowed: boolean;
  patchApproved: boolean;
  shellApproved: boolean;
  repairApproved: boolean;
  description: string;
};

export type AutonomyLimitEvent = BaseEvent & {
  type: "autonomy_limit_reached";
  status: "blocked_by_budget" | "blocked_by_iteration_limit" | "blocked_by_time_limit";
  reason: string;
};

export type TomorrowEdgeEvent =
  | ModelCallEvent
  | ContextSelectEvent
  | FileReadEvent
  | PatchCandidateEvent
  | ReviewEvent
  | JudgeEvent
  | PatchApplyEvent
  | ShellRunEvent
  | RepairEvent
  | ProviderFallbackEvent
  | CostUsageEvent
  | EvidenceEvent
  | SummaryEvent
  | AccessModeEvent
  | AutonomyLimitEvent;

export type EventArtifact = {
  ref: string;
  content: string;
};
