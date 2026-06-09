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

export type AgentRunEvent = BaseEvent & {
  type: "agent_run";
  agentKind?: "offline" | "live" | "external";
  status: "success" | "failure" | "blocked";
  runId: string;
  responseRef?: string;
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

export type RepairPolicyEvent = BaseEvent & {
  type: "repair_policy";
  failureClass: string;
  failureSignature: string;
  occurrence: number;
  action: "repair" | "retry_schema" | "expand_context" | "stop" | "escalate";
  strategy: string;
  reason: string;
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

export type ConversationTargetEvent = BaseEvent & {
  type: "conversation_target";
  target: string;
  targetKind: "core" | "role" | "debate" | "external_agent";
  label: string;
  description: string;
};

export type ConversationMessageEvent = BaseEvent & {
  type: "conversation_message";
  target: string;
  targetKind: "core" | "role" | "debate" | "external_agent";
  messageRef: string;
  summary: string;
};

export type WorkflowIntentEvent = BaseEvent & {
  type: "workflow_intent";
  intent: "inspect" | "patch" | "ask_user";
  requiresPatchWorkflow: boolean;
  workflowKind?: "read_only" | "patch" | "repair" | "vision_patch" | "advisory" | "ask_user";
  confidence: number;
  reason: string;
  fallbackUsed?: boolean;
};

export type TaskGovernanceEvent = BaseEvent & {
  type: "task_governance";
  reasoningSensitivity: "low" | "medium" | "high";
  requiresReviewer: boolean;
  requiresJudge: boolean;
  confidence: number;
  reason: string;
  fallbackUsed?: boolean;
};

export type ExternalAgentRegisteredEvent = BaseEvent & {
  type: "external_agent_registered";
  externalAgentId: string;
  name: string;
  transport: "mcp";
  capabilities: string[];
  allowedRoles: AgentRole[];
  trustLevel: string;
};

export type ExternalAgentCallEvent = BaseEvent & {
  type: "external_agent_call";
  externalAgentId: string;
  tool?: string;
  status: "start" | "success" | "failure";
  requestRef?: string;
  responseRef?: string;
  error?: string;
};

export type ExternalAgentResultEvent = BaseEvent & {
  type: "external_agent_result";
  externalAgentId: string;
  resultRef?: string;
  summary: string;
};

export type ExternalAgentPatchCandidateEvent = BaseEvent & {
  type: "external_agent_patch_candidate";
  externalAgentId: string;
  candidateId: string;
  filesChanged: string[];
  diffRef?: string;
  summary: string;
  estimatedRisk: "low" | "medium" | "high";
};

export type ExternalAgentReviewEvent = BaseEvent & {
  type: "external_agent_review";
  externalAgentId: string;
  reviewRef: string;
  recommendation: string;
};

export type ExternalAgentJudgmentEvent = BaseEvent & {
  type: "external_agent_judgment";
  externalAgentId: string;
  decision: string;
  selectedCandidateId?: string;
  reason: string;
  decisionRef: string;
};

export type ExternalAgentErrorEvent = BaseEvent & {
  type: "external_agent_error";
  externalAgentId: string;
  error: string;
};

export type ExternalAgentCostUsageEvent = BaseEvent & {
  type: "external_agent_cost_usage";
  externalAgentId: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
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

export type RoutingDecisionEvent = BaseEvent & {
  type: "routing_decision";
  assignedRole: AgentRole;
  assignedProvider: string;
  assignedModel: string;
  reason: string;
  policyTags: string[];
};

export type ContextProjectionEvent = BaseEvent & {
  type: "context_projection";
  selectedArtifacts: string[];
  projectedArtifacts: string[];
  tokenEstimate: number;
  omittedBytes: number;
  policySummary: string;
};

export type ArtifactProjectionEvent = BaseEvent & {
  type: "artifact_projection";
  artifactRef: string;
  artifactKind: "stdout" | "stderr" | "diff" | "file" | "review" | "judge" | "trace" | "json";
  previewRef: string;
  handle: string;
  policy: "tail" | "head_tail" | "structured" | "summary" | "full";
  omittedBytes?: number;
  tokenEstimate?: number;
};

export type EvidencePacketEvent = BaseEvent & {
  type: "evidence_packet";
  packetId: string;
  evidencePhase: "plan" | "patch" | "test" | "repair" | "review" | "judge";
  summary: string;
  verificationStatus: "unverified" | "passed" | "failed" | "partial";
  supportingArtifacts: string[];
  packetRef: string;
};

export type BudgetDecisionEvent = BaseEvent & {
  type: "budget_decision";
  status: "allowed" | "blocked" | "warn";
  reason: string;
  budgetScope?: "global_strong_pool" | "per_role" | "efficient";
  maxCostUsd?: number;
  estimatedCostUsd?: number;
  strongAgentCallsUsed?: number;
  strongAgentCallsRemaining?: number;
};

export type BudgetPreviewEvent = BaseEvent & {
  type: "budget_preview";
  status: "allowed" | "blocked" | "warn";
  reason: string;
  budgetScope?: "global_strong_pool" | "per_role" | "efficient";
  maxCostUsd?: number;
  estimatedCostUsd?: number;
  strongAgentCallsUsed?: number;
  strongAgentCallsRemaining?: number;
};

export type WorkflowStopReasonEvent = BaseEvent & {
  type: "workflow_stop_reason";
  reason: string;
  result: string;
};

export type FallbackToNativeEvent = BaseEvent & {
  type: "fallback_to_native";
  externalAgentId?: string;
  fallbackRole: AgentRole;
  reason: string;
};

export type TraceCompletenessEvent = BaseEvent & {
  type: "trace_completeness";
  score: number;
  missing: string[];
  workflowKind?: "read_only" | "patch" | "repair" | "vision_patch" | "advisory" | "ask_user";
};

export type AgentCacheEvent = BaseEvent & {
  type: "agent_cache";
  cache: "planner" | "explorer";
  status: "hit" | "miss" | "write";
  keyHint: string;
};

export type MemoryRetrievalEvent = BaseEvent & {
  type: "memory_retrieval";
  retrievalStage: "premortem" | "coder_constraints" | "review_guard" | "repair_context";
  selectedMemoryIds: string[];
  rejectedCount: number;
  constraintCount: number;
  artifactRef?: string;
  summary: string;
};

export type TomorrowEdgeEvent =
  | ModelCallEvent
  | AgentRunEvent
  | ContextSelectEvent
  | FileReadEvent
  | PatchCandidateEvent
  | ReviewEvent
  | JudgeEvent
  | PatchApplyEvent
  | ShellRunEvent
  | RepairEvent
  | RepairPolicyEvent
  | ProviderFallbackEvent
  | CostUsageEvent
  | ConversationTargetEvent
  | ConversationMessageEvent
  | WorkflowIntentEvent
  | TaskGovernanceEvent
  | ExternalAgentRegisteredEvent
  | ExternalAgentCallEvent
  | ExternalAgentResultEvent
  | ExternalAgentPatchCandidateEvent
  | ExternalAgentReviewEvent
  | ExternalAgentJudgmentEvent
  | ExternalAgentErrorEvent
  | ExternalAgentCostUsageEvent
  | EvidenceEvent
  | SummaryEvent
  | AccessModeEvent
  | AutonomyLimitEvent
  | RoutingDecisionEvent
  | ContextProjectionEvent
  | ArtifactProjectionEvent
  | EvidencePacketEvent
  | BudgetPreviewEvent
  | BudgetDecisionEvent
  | WorkflowStopReasonEvent
  | FallbackToNativeEvent
  | TraceCompletenessEvent
  | AgentCacheEvent
  | MemoryRetrievalEvent;

export type EventArtifact = {
  ref: string;
  content: string;
};
