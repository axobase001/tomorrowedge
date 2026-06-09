import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGraphState } from "../agentGraph/state.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { redactText } from "../../safety/secretScanner.js";
import type { OutcomeMismatchType } from "../events/eventTypes.js";

export type TaskMemory = {
  preferredTestCommands: string[];
  commonConstraints: string[];
  routingPreference?: string;
};

export type LearnedTaskMemory = {
  schemaVersion?: "task-memory/v1" | "task-memory/v2";
  createdAt: string;
  firstSeen?: string;
  lastSeen?: string;
  goalFingerprint: string;
  goalPreview?: string;
  memoryScope?: MemoryScope;
  taskType: string;
  riskLevel: string;
  routingMode: string;
  accessMode: string;
  visualPageType?: string;
  capabilitySummary?: string;
  constraints: string[];
  verificationCommands: string[];
  selectedCandidate?: string;
  judgeDecision?: string;
  result?: string;
  routeAssignments?: Array<{ role: AgentRole; provider: string; model: string }>;
  failureClass?: FailureClass;
  failureSignature?: string;
  correction?: string;
  wrongAssumption?: string;
  correctedRule?: string;
  applicability?: string[];
  counterexamples?: string[];
  validationCommand?: string;
  correctionStatus?: CorrectionStatus;
  evidenceRefs?: string[];
  outcomePredictionRefs?: string[];
  outcomeObservationRefs?: string[];
  outcomeMismatchType?: OutcomeMismatchType;
  predictionAccuracy?: { matched: number; total: number };
  confidence?: number;
  recurrenceCount?: number;
  fixedCount?: number;
  sourceSessionIds?: string[];
  failureMemoryConsent?: "enabled";
  failureMemoryStorageScope?: FailureMemoryStorageScope;
  failureMemoryRedaction?: FailureMemoryRedaction;
  failureMemoryRetentionDays?: number;
};

export type FailureMemoryStorageScope = "project" | "experiment";
export type FailureMemoryRedaction = "metadata_only" | "artifact_refs";
export type CorrectionStatus = "verified" | "partial" | "unverified";

export type FailureMemoryPolicy = {
  enabled: boolean;
  storageScope: FailureMemoryStorageScope;
  redaction: FailureMemoryRedaction;
  retentionDays: number;
  experimentId?: string;
};

export type FailureMemoryPolicyInput = Partial<FailureMemoryPolicy> & {
  storage_scope?: FailureMemoryStorageScope;
  retention_days?: number;
};

export type FailureMemoryPreview = {
  wouldWrite: boolean;
  reason: string;
  policy: FailureMemoryPolicy;
  record?: LearnedTaskMemory;
};

export type MemoryScope = {
  projectFingerprint: string;
  dependencyLockHash?: string;
  fixtureFamily?: string;
  experimentId?: string;
};

export type StrategyMemoryHints = {
  routeAssignments: Array<{ role: AgentRole; provider: string; model: string; reason: string }>;
  preferredTestCommand?: string;
  sourceRecords: number;
};

export type FailureClass =
  | "coding_error"
  | "validation_failed"
  | "review_or_judge_blocked"
  | "provider_failure"
  | "routing_blocked"
  | "environment_failure"
  | "partial_completion"
  | "no_candidate_selected"
  | "workflow_incomplete";

export type FailureMemoryRecord = LearnedTaskMemory & {
  id: string;
  schemaVersion: "task-memory/v1" | "task-memory/v2";
  firstSeen: string;
  lastSeen: string;
  memoryScope?: MemoryScope;
  failureClass: FailureClass;
  failureSignature: string;
  correction: string;
  wrongAssumption?: string;
  correctedRule?: string;
  applicability?: string[];
  counterexamples?: string[];
  validationCommand?: string;
  correctionStatus?: CorrectionStatus;
  evidenceRefs: string[];
  outcomePredictionRefs?: string[];
  outcomeObservationRefs?: string[];
  outcomeMismatchType?: OutcomeMismatchType;
  predictionAccuracy?: { matched: number; total: number };
  confidence: number;
  recurrence: number;
  recurrenceCount: number;
  fixedCount: number;
  sourceSessionIds: string[];
  stale: boolean;
  staleReason?: string;
};

export type FailureMemoryExplanation = {
  task: string;
  selected: Array<FailureMemoryRecord & { score: number; matchedSignals: string[] }>;
  rejected: Array<{ id: string; reason: string }>;
};

export const emptyTaskMemory: TaskMemory = {
  preferredTestCommands: [],
  commonConstraints: []
};

export const defaultFailureMemoryPolicy: FailureMemoryPolicy = {
  enabled: false,
  storageScope: "project",
  redaction: "metadata_only",
  retentionDays: 30
};

export async function appendLearnedTaskMemory(cwd: string, state: AgentGraphState, options: { failureMemory?: FailureMemoryPolicyInput } = {}): Promise<void> {
  const preview = await previewLearnedTaskMemory(cwd, state, options);
  if (!preview.record || !preview.wouldWrite) return;
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  const records = await readLearnedTaskMemory(cwd, 10_000, { newestFirst: false, includeStale: true });
  const merged = mergeLearnedMemory(records, preview.record);
  await writeTaskMemoryFile(cwd, merged);
}

export async function previewLearnedTaskMemory(cwd: string, state: AgentGraphState, options: { failureMemory?: FailureMemoryPolicyInput } = {}): Promise<FailureMemoryPreview> {
  const policy = normalizeFailureMemoryPolicy(options.failureMemory);
  const now = new Date().toISOString();
  const record: LearnedTaskMemory = {
    schemaVersion: "task-memory/v2",
    createdAt: now,
    firstSeen: now,
    lastSeen: now,
    goalFingerprint: fingerprintGoal(state.goal),
    goalPreview: clip(redactMemoryText(state.goal), 180),
    memoryScope: await buildMemoryScope(cwd, policy),
    taskType: state.plan?.taskType ?? "unknown",
    riskLevel: state.plan?.riskLevel ?? "unknown",
    routingMode: state.routing.mode,
    accessMode: state.access.mode,
    visualPageType: state.visualSpec?.pageType,
    capabilitySummary: state.capabilityRoute?.summary,
    constraints: state.plan?.constraints ?? [],
    verificationCommands: state.plan?.verificationCommands ?? [],
    selectedCandidate: state.judge?.selectedCandidateId,
    judgeDecision: state.judge?.decision,
    result: state.finalSummary?.result,
    routeAssignments: state.finalSummary?.result === "completed"
      ? state.routing.assignments
          .filter((assignment) => !["runner", "vision"].includes(assignment.role))
          .map((assignment) => ({ role: assignment.role, provider: assignment.provider, model: assignment.model }))
      : []
  };
  Object.assign(record, summarizeOutcomeEvents(state));
  const failure = buildFailureMemoryFields(state, record);
  if (!failure.failureClass) {
    return { wouldWrite: true, reason: "success_or_non_failure_task_metadata", policy, record };
  }
  Object.assign(record, failure, {
    failureMemoryConsent: "enabled",
    failureMemoryStorageScope: policy.storageScope,
    failureMemoryRedaction: policy.redaction,
    failureMemoryRetentionDays: policy.retentionDays
  });
  if (policy.redaction === "metadata_only") record.evidenceRefs = [];
  if (record.failureClass) {
    record.failureSignature = buildFailureSignature(state, record);
    record.recurrenceCount = 1;
    record.fixedCount = state.finalSummary?.result === "completed" ? 1 : 0;
    record.sourceSessionIds = [state.sessionId];
  }
  return {
    wouldWrite: policy.enabled,
    reason: policy.enabled ? "failure_memory.enabled" : "failure_memory.disabled",
    policy,
    record
  };
}

export async function buildStrategyMemoryHints(cwd: string, options: { limit?: number } = {}): Promise<StrategyMemoryHints> {
  const records = await readLearnedTaskMemory(cwd, options.limit ?? 20);
  const successful = records.filter((record) => record.result === "completed");
  const routeByRole = new Map<AgentRole, { role: AgentRole; provider: string; model: string; reason: string }>();
  for (const record of successful) {
    for (const route of record.routeAssignments ?? []) {
      if (!routeByRole.has(route.role)) {
        routeByRole.set(route.role, {
          ...route,
          reason: `strategy memory: reused ${route.provider}/${route.model} from recent completed ${record.taskType} workflow`
        });
      }
    }
  }
  const preferredTestCommand = mostCommon(successful.flatMap((record) => record.verificationCommands ?? []));
  return {
    routeAssignments: [...routeByRole.values()],
    preferredTestCommand,
    sourceRecords: successful.length
  };
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export async function readLearnedTaskMemory(cwd: string, limit = 20, options: { newestFirst?: boolean; includeStale?: boolean } = {}): Promise<LearnedTaskMemory[]> {
  const filePath = path.join(cwd, ".tomorrowedge", "task-memory.jsonl");
  const content = await readFile(filePath, "utf8").catch(() => "");
  const records = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LearnedTaskMemory);
  const filtered = options.includeStale ? records : records.filter((record) => !staleStatus(record, cwd).stale);
  const selected = filtered.slice(-limit);
  return options.newestFirst === false ? selected : selected.reverse();
}

export async function readFailureMemories(cwd: string, limit = 20, options: { includeStale?: boolean } = {}): Promise<FailureMemoryRecord[]> {
  const records = await readLearnedTaskMemory(cwd, Math.max(limit * 4, limit), { includeStale: true });
  const failures = records
    .filter((record) => Boolean(record.failureClass) || record.result === "failed" || record.result === "partially_completed" || record.result === "aborted")
    .map((record) => normalizeFailureRecord(record, cwd))
    .filter((record) => options.includeStale || !record.stale);
  const recurrence = new Map<string, number>();
  for (const record of failures) {
    const key = record.failureSignature || `${record.taskType}:${record.failureClass}`;
    recurrence.set(key, (recurrence.get(key) ?? 0) + 1);
  }
  return failures.map((record) => ({
    ...record,
    recurrence: record.recurrenceCount ?? recurrence.get(record.failureSignature || `${record.taskType}:${record.failureClass}`) ?? 1
  })).slice(0, limit);
}

export async function showFailureMemory(cwd: string, id: string, options: { includeStale?: boolean } = {}): Promise<FailureMemoryRecord | undefined> {
  const records = await readFailureMemories(cwd, 200, { includeStale: options.includeStale });
  return records.find((record) => record.id === id || record.goalFingerprint === id);
}

export async function deleteFailureMemory(cwd: string, id: string): Promise<boolean> {
  const records = await readLearnedTaskMemory(cwd, 10_000, { newestFirst: false, includeStale: true });
  const next = records.filter((record) => {
    const failure = normalizeFailureRecord(record, cwd);
    return failure.id !== id && failure.goalFingerprint !== id;
  });
  if (next.length === records.length) return false;
  await writeTaskMemoryFile(cwd, next);
  return true;
}

export async function compactFailureMemories(cwd: string, options: { keepStale?: boolean; limit?: number } = {}): Promise<{ before: number; after: number; removed: number }> {
  const records = await readLearnedTaskMemory(cwd, 10_000, { newestFirst: false, includeStale: true });
  const nonFailure = records.filter((record) => !isFailureMemoryLike(record));
  const failures = records.filter(isFailureMemoryLike);
  const keptFailures = failures
    .filter((record) => options.keepStale || !normalizeFailureRecord(record, cwd).stale)
    .slice(-(options.limit ?? 10_000));
  const kept = [...nonFailure, ...keptFailures].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  await writeTaskMemoryFile(cwd, kept);
  return { before: records.length, after: kept.length, removed: records.length - kept.length };
}

export async function explainFailureMemories(cwd: string, task: string, options: { limit?: number } = {}): Promise<FailureMemoryExplanation> {
  const records = await readFailureMemories(cwd, Math.max(options.limit ?? 5, 20), { includeStale: true });
  const taskSignals = tokenize(task);
  const selected: Array<FailureMemoryRecord & { score: number; matchedSignals: string[] }> = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const record of records) {
    if (record.stale) {
      rejected.push({ id: record.id, reason: `stale: ${record.staleReason ?? "lifecycle policy"}` });
      continue;
    }
    if (record.confidence < 0.55) {
      rejected.push({ id: record.id, reason: "low confidence" });
      continue;
    }
    const recordSignals = tokenize([
      record.goalPreview,
      record.taskType,
      record.riskLevel,
      record.failureClass,
      record.correction,
      record.wrongAssumption,
      record.correctedRule,
      record.validationCommand,
      record.correctionStatus,
      ...(record.applicability ?? []),
      ...(record.counterexamples ?? []),
      ...(record.constraints ?? []),
      ...(record.verificationCommands ?? [])
    ].filter(Boolean).join(" "));
    const matchedSignals = [...taskSignals].filter((signal) => recordSignals.has(signal));
    const score =
      matchedSignals.length * 3 +
      (record.taskType !== "unknown" && taskSignals.has(record.taskType) ? 4 : 0) +
      (record.failureClass === "review_or_judge_blocked" && /review|judge|审查|裁决/i.test(task) ? 4 : 0) +
      (record.failureClass === "validation_failed" && /test|verify|验证|测试/i.test(task) ? 4 : 0) +
      correctionStatusScore(record.correctionStatus) +
      Math.min(record.recurrence, 4);
    if (score >= 3) selected.push({ ...record, score, matchedSignals });
    else rejected.push({ id: record.id, reason: "low task-signal overlap" });
  }
  selected.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  return {
    task: clip(redactMemoryText(task), 180),
    selected: selected.slice(0, options.limit ?? 5),
    rejected: rejected.slice(0, 12)
  };
}

function normalizeFailureMemoryPolicy(policy: FailureMemoryPolicyInput | undefined): FailureMemoryPolicy {
  return {
    ...defaultFailureMemoryPolicy,
    ...policy,
    storageScope: policy?.storageScope ?? policy?.storage_scope ?? defaultFailureMemoryPolicy.storageScope,
    retentionDays: Math.max(1, Math.floor(policy?.retentionDays ?? policy?.retention_days ?? defaultFailureMemoryPolicy.retentionDays))
  };
}

function isFailureMemoryLike(record: LearnedTaskMemory): boolean {
  return Boolean(record.failureClass || record.failureMemoryConsent === "enabled" || ["failed", "partially_completed", "aborted"].includes(record.result ?? ""));
}

function fingerprintGoal(goal: string): string {
  const normalized = goal.toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 0;
  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildFailureMemoryFields(state: AgentGraphState, record: LearnedTaskMemory): Partial<LearnedTaskMemory> {
  if (record.result === "completed") return {};
  const failureClass = classifyFailure(state, record);
  const evidenceRefs = collectEvidenceRefs(state);
  const outcome = summarizeOutcomeEvents(state);
  const correction = correctionForFailure(failureClass, state, record);
  return {
    failureClass,
    correction,
    wrongAssumption: wrongAssumptionForFailure(failureClass, state, record),
    correctedRule: correctedRuleForFailure(failureClass, correction, state, record),
    applicability: applicabilityForFailure(failureClass, state, record),
    counterexamples: counterexamplesForFailure(failureClass, state, record),
    validationCommand: primaryValidationCommand(state, record),
    correctionStatus: correctionStatusForState(state, evidenceRefs),
    evidenceRefs,
    outcomePredictionRefs: outcome.outcomePredictionRefs,
    outcomeObservationRefs: outcome.outcomeObservationRefs,
    outcomeMismatchType: outcome.outcomeMismatchType,
    predictionAccuracy: outcome.predictionAccuracy,
    confidence: confidenceForFailure(failureClass, evidenceRefs)
  };
}

function normalizeFailureRecord(record: LearnedTaskMemory, cwd: string): FailureMemoryRecord {
  const failureClass = record.failureClass ?? classifyLegacyFailure(record);
  const evidenceRefs = record.evidenceRefs ?? [];
  const firstSeen = record.firstSeen ?? record.createdAt;
  const lastSeen = record.lastSeen ?? record.createdAt;
  const lifecycle = staleStatus(record, cwd);
  const correction = record.correction ?? correctionForFailure(failureClass, undefined, record);
  const fallbackSignature = hashText([
    failureClass,
    record.taskType,
    record.riskLevel,
    (record.verificationCommands ?? []).join(","),
    (record.selectedCandidate ?? "")
  ].join("|"));
  return {
    ...record,
    schemaVersion: record.schemaVersion ?? "task-memory/v1",
    id: failureMemoryId(record),
    firstSeen,
    lastSeen,
    failureClass,
    failureSignature: record.failureSignature ?? fallbackSignature,
    correction,
    wrongAssumption: record.wrongAssumption ?? wrongAssumptionForFailure(failureClass, undefined, record),
    correctedRule: record.correctedRule ?? correctedRuleForFailure(failureClass, correction, undefined, record),
    applicability: record.applicability ?? applicabilityForFailure(failureClass, undefined, record),
    counterexamples: record.counterexamples ?? counterexamplesForFailure(failureClass, undefined, record),
    validationCommand: record.validationCommand ?? primaryValidationCommand(undefined, record),
    correctionStatus: record.correctionStatus ?? correctionStatusForRecord(record, evidenceRefs),
    evidenceRefs,
    outcomePredictionRefs: record.outcomePredictionRefs,
    outcomeObservationRefs: record.outcomeObservationRefs,
    outcomeMismatchType: record.outcomeMismatchType,
    predictionAccuracy: record.predictionAccuracy,
    confidence: record.confidence ?? confidenceForFailure(failureClass, evidenceRefs),
    recurrence: record.recurrenceCount ?? 1,
    recurrenceCount: record.recurrenceCount ?? 1,
    fixedCount: record.fixedCount ?? (record.result === "completed" ? 1 : 0),
    sourceSessionIds: record.sourceSessionIds ?? [],
    stale: lifecycle.stale,
    staleReason: lifecycle.reason
  };
}

function failureMemoryId(record: LearnedTaskMemory): string {
  const stamp = record.createdAt.replace(/[-:.TZ]/g, "").slice(0, 14) || "unknown";
  return record.failureSignature ? `${record.failureSignature.slice(0, 12)}-${record.goalFingerprint}` : `${stamp}-${record.goalFingerprint}`;
}

function classifyFailure(state: AgentGraphState, record: LearnedTaskMemory): FailureClass {
  const eventText = state.events.map((event) => `${event.type} ${"summary" in event ? event.summary : ""} ${"error" in event ? event.error ?? "" : ""}`).join("\n");
  const runText = state.runResults.map((run) => `${run.command}\n${run.stderr}\n${run.stdout}`).join("\n");
  if (/provider_(?:fallback|error|failure)|external_agent_error/i.test(eventText)) return "provider_failure";
  if (/routing.*blocked|fallback_to_native/i.test(eventText)) return "routing_blocked";
  if (state.runResults.some((run) => !run.success && !run.skipped)) {
    if (/not recognized|not found|ENOENT|permission denied|access is denied/i.test(runText)) return "environment_failure";
    return "validation_failed";
  }
  if (state.judge?.decision === "request_revision" || record.judgeDecision === "request_revision") return "review_or_judge_blocked";
  if (!record.selectedCandidate && state.candidates.length === 0) return "no_candidate_selected";
  if (record.result === "partially_completed") return "partial_completion";
  if (state.candidates.some((candidate) => candidate.unifiedDiff || candidate.filesChanged.length)) return "coding_error";
  return "workflow_incomplete";
}

function classifyLegacyFailure(record: LearnedTaskMemory): FailureClass {
  if (record.judgeDecision === "request_revision") return "review_or_judge_blocked";
  if (record.result === "failed") return "validation_failed";
  if (record.result === "partially_completed") return "partial_completion";
  if (!record.selectedCandidate) return "no_candidate_selected";
  return "workflow_incomplete";
}

function correctionForFailure(failureClass: FailureClass, state: AgentGraphState | undefined, record: LearnedTaskMemory): string {
  const command = state?.runResults.find((run) => !run.success && !run.skipped)?.command ?? record.verificationCommands[0];
  switch (failureClass) {
    case "coding_error":
      return "Re-run review against the concrete diff before applying; require a narrower patch and explicit regression evidence.";
    case "validation_failed":
      return `Prioritize reproducing the failed verifier${command ? ` (${command})` : ""}, then route repair with stderr/test evidence instead of raw logs.`;
    case "review_or_judge_blocked":
      return "Escalate reviewer and judge with the candidate patch plus evidence packet; do not mark success until blocking concerns are resolved.";
    case "provider_failure":
      return "Retry with a provider health check, then route to an alternate configured model while preserving provider_fallback events.";
    case "routing_blocked":
      return "Explain why the selected role route was blocked and fallback to native/mock only after recording the routing reason.";
    case "environment_failure":
      return "Check local tool availability, cwd, and permissions before blaming the patch; keep environment errors separate from agent mistakes.";
    case "partial_completion":
      return "Treat the run as incomplete: ask for missing patch, shell, review, or approval evidence before writing a completed summary.";
    case "no_candidate_selected":
      return "Regenerate candidates or request a planner split; judge should not proceed without at least one inspectable candidate.";
    case "workflow_incomplete":
      return "Inspect stop reason and missing trace stages before reusing this memory as a routing hint.";
  }
}

function wrongAssumptionForFailure(failureClass: FailureClass, state: AgentGraphState | undefined, record: LearnedTaskMemory): string {
  const command = primaryValidationCommand(state, record);
  switch (failureClass) {
    case "validation_failed":
      return command
        ? `The patch was assumed safe before ${command} passed.`
        : "The patch was assumed safe before a verifier passed.";
    case "review_or_judge_blocked":
      return "A candidate was treated as selectable before reviewer/judge blockers were resolved.";
    case "provider_failure":
      return "Provider output or availability was treated as reliable enough to continue.";
    case "routing_blocked":
      return "The selected route was assumed executable without a confirmed fallback path.";
    case "environment_failure":
      return "A local tool or permission failure was treated like an implementation failure.";
    case "partial_completion":
      return "The workflow was assumed complete before all required trace stages existed.";
    case "no_candidate_selected":
      return "The judge path was assumed usable without an inspectable candidate.";
    case "workflow_incomplete":
      return "The run stopped before enough evidence existed to reuse it as a success pattern.";
    case "coding_error":
      return "The implementation patch was assumed narrow and correct before concrete evidence supported it.";
  }
}

function correctedRuleForFailure(failureClass: FailureClass, correction: string, state: AgentGraphState | undefined, record: LearnedTaskMemory): string {
  const command = primaryValidationCommand(state, record);
  switch (failureClass) {
    case "validation_failed":
      return command
        ? `Reproduce and pass ${command} before treating the patch as fixed.`
        : "Reproduce and pass the relevant verifier before treating the patch as fixed.";
    case "review_or_judge_blocked":
      return "Reviewer and judge blockers must be resolved before selection or summary completion.";
    case "provider_failure":
      return "Provider failures require health check, fallback trace, or alternate route before implementation blame.";
    case "routing_blocked":
      return "Blocked role routes must record the reason and use a native or configured fallback before success is claimed.";
    case "environment_failure":
      return "Separate environment/tooling failures from patch quality and verify cwd/tool availability first.";
    case "partial_completion":
    case "workflow_incomplete":
      return "Require patch, review, judge, verification, and stop-reason evidence appropriate to the workflow kind.";
    case "no_candidate_selected":
      return "Regenerate or split planning until at least one candidate has an inspectable diff or explicit no-op rationale.";
    case "coding_error":
      return "Keep the patch narrow, evidence-backed, and reviewed against the concrete changed files.";
  }
  return correction;
}

function applicabilityForFailure(failureClass: FailureClass, state: AgentGraphState | undefined, record: LearnedTaskMemory): string[] {
  return unique([
    `failure_class:${failureClass}`,
    `task_type:${record.taskType}`,
    `risk:${record.riskLevel}`,
    primaryValidationCommand(state, record) ? `verifier:${primaryValidationCommand(state, record)}` : "",
    ...(state?.changedFiles ?? []).slice(0, 4).map((file) => `file:${redactMemoryText(file)}`)
  ]).slice(0, 8);
}

function counterexamplesForFailure(failureClass: FailureClass, state: AgentGraphState | undefined, record: LearnedTaskMemory): string[] {
  const command = primaryValidationCommand(state, record);
  const values: string[] = [];
  if (failureClass === "validation_failed" && command) values.push(`Do not apply when ${command} already passed after the candidate patch.`);
  if (failureClass === "environment_failure") values.push("Do not treat as a coding lesson when the verifier fails for missing tools, cwd, or permissions.");
  if (failureClass === "provider_failure") values.push("Do not treat as a coding lesson when the provider call failed before producing a usable patch.");
  if (failureClass === "routing_blocked") values.push("Do not reuse as implementation advice when only role routing was blocked.");
  if (!values.length) values.push("Do not apply when the current task has different verifier, changed files, and failure class.");
  return values.map((value) => redactMemoryText(value)).slice(0, 6);
}

function primaryValidationCommand(state: AgentGraphState | undefined, record: LearnedTaskMemory): string | undefined {
  return state?.runResults.find((run) => !run.success && !run.skipped)?.command
    ?? state?.runResults.find((run) => run.success && !run.skipped)?.command
    ?? record.verificationCommands?.[0];
}

function correctionStatusForState(state: AgentGraphState, evidenceRefs: string[]): CorrectionStatus {
  if (state.finalSummary?.result === "completed" && state.runResults.some((run) => run.success && !run.skipped)) return "verified";
  if (state.runResults.some((run) => !run.success && !run.skipped) || evidenceRefs.length) return "partial";
  return "unverified";
}

function correctionStatusForRecord(record: LearnedTaskMemory, evidenceRefs: string[]): CorrectionStatus {
  if (record.correctionStatus) return record.correctionStatus;
  if ((record.fixedCount ?? 0) > 0 || record.result === "completed") return "verified";
  if (evidenceRefs.length || record.outcomeObservationRefs?.length) return "partial";
  return "unverified";
}

function correctionStatusScore(status: CorrectionStatus | undefined): number {
  if (status === "verified") return 2;
  if (status === "partial") return 1;
  if (status === "unverified") return -1;
  return 0;
}

function strongerCorrectionStatus(a: CorrectionStatus | undefined, b: CorrectionStatus | undefined): CorrectionStatus | undefined {
  const rank: Record<CorrectionStatus, number> = { unverified: 0, partial: 1, verified: 2 };
  if (!a) return b;
  if (!b) return a;
  return rank[b] > rank[a] ? b : a;
}

function collectEvidenceRefs(state: AgentGraphState): string[] {
  const refs = [
    ...state.eventArtifacts.map((artifact) => artifact.ref),
    ...state.events.flatMap((event) => {
      const values: string[] = [];
      if ("diffRef" in event && event.diffRef) values.push(event.diffRef);
      if ("stdoutRef" in event && event.stdoutRef) values.push(event.stdoutRef);
      if ("stderrRef" in event && event.stderrRef) values.push(event.stderrRef);
      if ("reviewRef" in event && event.reviewRef) values.push(event.reviewRef);
      if ("decisionRef" in event && event.decisionRef) values.push(event.decisionRef);
      if ("summaryRef" in event && event.summaryRef) values.push(event.summaryRef);
      if ("responseRef" in event && event.responseRef) values.push(event.responseRef);
      if ("packetRef" in event && event.packetRef) values.push(event.packetRef);
      if ("previewRef" in event && event.previewRef) values.push(event.previewRef);
      if ("predictionRef" in event && event.predictionRef) values.push(event.predictionRef);
      if ("observationRef" in event && event.observationRef) values.push(event.observationRef);
      if ("selectedArtifacts" in event) values.push(...event.selectedArtifacts);
      if ("projectedArtifacts" in event) values.push(...event.projectedArtifacts);
      if ("supportingArtifacts" in event) values.push(...event.supportingArtifacts);
      return values;
    })
  ];
  return [...new Set(refs.map((ref) => redactMemoryText(ref)).filter(Boolean))].slice(0, 12);
}

function summarizeOutcomeEvents(state: AgentGraphState): Pick<LearnedTaskMemory, "outcomePredictionRefs" | "outcomeObservationRefs" | "outcomeMismatchType" | "predictionAccuracy"> {
  const predictions = state.events.filter((event) => event.type === "outcome_prediction");
  const observations = state.events.filter((event) => event.type === "outcome_observation");
  const mismatches = observations.filter((event) => !event.matched);
  return {
    outcomePredictionRefs: predictions.length ? predictions.map((event) => event.id).slice(-8) : undefined,
    outcomeObservationRefs: observations.length ? observations.map((event) => event.id).slice(-8) : undefined,
    outcomeMismatchType: mismatches.at(-1)?.mismatchType,
    predictionAccuracy: observations.length
      ? { matched: observations.filter((event) => event.matched).length, total: observations.length }
      : undefined
  };
}

function mergeLearnedMemory(records: LearnedTaskMemory[], next: LearnedTaskMemory): LearnedTaskMemory[] {
  if (!next.failureClass || !next.failureSignature) return [...records, next];
  const index = records.findIndex((record) =>
    record.failureSignature === next.failureSignature &&
    sameMemoryScope(record.memoryScope, next.memoryScope)
  );
  if (index < 0) return [...records, next];
  const current = records[index]!;
  const merged: LearnedTaskMemory = {
    ...current,
    ...next,
    createdAt: current.createdAt,
    firstSeen: current.firstSeen ?? current.createdAt,
    lastSeen: next.lastSeen ?? next.createdAt,
    recurrenceCount: (current.recurrenceCount ?? 1) + 1,
    fixedCount: (current.fixedCount ?? (current.result === "completed" ? 1 : 0)) + (next.result === "completed" ? 1 : 0),
    sourceSessionIds: unique([...(current.sourceSessionIds ?? []), ...(next.sourceSessionIds ?? [])]),
    evidenceRefs: unique([...(current.evidenceRefs ?? []), ...(next.evidenceRefs ?? [])]).slice(0, 12),
    applicability: unique([...(current.applicability ?? []), ...(next.applicability ?? [])]).slice(0, 12),
    counterexamples: unique([...(current.counterexamples ?? []), ...(next.counterexamples ?? [])]).slice(0, 8),
    correctionStatus: strongerCorrectionStatus(current.correctionStatus, next.correctionStatus),
    confidence: Math.max(current.confidence ?? 0, next.confidence ?? 0)
  };
  return records.map((record, recordIndex) => recordIndex === index ? merged : record);
}

async function writeTaskMemoryFile(cwd: string, records: LearnedTaskMemory[]): Promise<void> {
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "task-memory.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}

async function buildMemoryScope(cwd: string, policy?: FailureMemoryPolicy): Promise<MemoryScope> {
  return {
    projectFingerprint: hashText(path.resolve(cwd).toLowerCase()),
    dependencyLockHash: await dependencyLockHash(cwd),
    fixtureFamily: "native-fixture",
    experimentId: policy?.storageScope === "experiment" ? policy.experimentId ?? "experiment" : undefined
  };
}

async function dependencyLockHash(cwd: string): Promise<string | undefined> {
  const lockFiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];
  for (const file of lockFiles) {
    const content = await readFile(path.join(cwd, file)).catch(() => undefined);
    if (content) return hashText(`${file}:${content.toString("utf8")}`);
  }
  return undefined;
}

function staleStatus(record: LearnedTaskMemory, cwd: string): { stale: boolean; reason?: string } {
  if (record.schemaVersion && record.schemaVersion !== "task-memory/v1" && record.schemaVersion !== "task-memory/v2") {
    return { stale: true, reason: `unsupported schema ${record.schemaVersion}` };
  }
  const projectFingerprint = hashText(path.resolve(cwd).toLowerCase());
  if (record.memoryScope?.projectFingerprint && record.memoryScope.projectFingerprint !== projectFingerprint) {
    return { stale: true, reason: "project scope changed" };
  }
  const lastSeenTime = Date.parse(record.lastSeen ?? record.createdAt);
  const ttlMs = Number(record.failureMemoryRetentionDays ?? process.env.TOMORROWEDGE_MEMORY_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;
  if (Number.isFinite(lastSeenTime) && ttlMs > 0 && Date.now() - lastSeenTime > ttlMs) {
    return { stale: true, reason: "memory TTL expired" };
  }
  return { stale: false };
}

function buildFailureSignature(state: AgentGraphState, record: LearnedTaskMemory): string {
  const failedRun = state.runResults.find((run) => !run.success && !run.skipped);
  const errorSignature = clip(redactMemoryText([failedRun?.stderr, failedRun?.stdout].filter(Boolean).join("\n")), 220)
    .replace(/\d+/g, "#")
    .toLowerCase();
  const files = unique([
    ...state.changedFiles,
    ...state.candidates.flatMap((candidate) => candidate.filesChanged),
    ...state.repairCandidates.flatMap((candidate) => candidate.filesChanged)
  ]).sort().join(",");
  return hashText([
    record.failureClass,
    record.taskType,
    record.riskLevel,
    record.verificationCommands.join(","),
    failedRun?.command ?? "",
    files,
    record.outcomeMismatchType ?? "",
    errorSignature
  ].join("|"));
}

function sameMemoryScope(a: MemoryScope | undefined, b: MemoryScope | undefined): boolean {
  return (a?.projectFingerprint ?? "") === (b?.projectFingerprint ?? "")
    && (a?.dependencyLockHash ?? "") === (b?.dependencyLockHash ?? "")
    && (a?.fixtureFamily ?? "") === (b?.fixtureFamily ?? "")
    && (a?.experimentId ?? "") === (b?.experimentId ?? "");
}

function confidenceForFailure(failureClass: FailureClass, evidenceRefs: string[]): number {
  const base: Record<FailureClass, number> = {
    coding_error: 0.62,
    validation_failed: 0.82,
    review_or_judge_blocked: 0.78,
    provider_failure: 0.7,
    routing_blocked: 0.68,
    environment_failure: 0.66,
    partial_completion: 0.58,
    no_candidate_selected: 0.56,
    workflow_incomplete: 0.5
  };
  return Math.min(0.95, base[failureClass] + (evidenceRefs.length ? 0.05 : 0));
}

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function redactMemoryText(value: string): string {
  return redactText(value)
    .replace(/[A-Za-z]:[\\/][^\s"'`<>|]+/g, "[path]")
    .replace(/\/(?:Users|home|data|tmp|var|opt)\/[^\s"'`<>|]+/g, "[path]")
    .replace(/\\\\[^\\/\s]+\\[^\s"'`<>|]+/g, "[path]");
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_./-]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && !stopWords.has(item))
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const stopWords = new Set(["the", "and", "for", "with", "from", "this", "that", "task", "code", "file", "test", "fix", "add", "run"]);
