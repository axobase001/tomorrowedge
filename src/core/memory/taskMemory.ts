import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentGraphState } from "../agentGraph/state.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { redactText } from "../../safety/secretScanner.js";

export type TaskMemory = {
  preferredTestCommands: string[];
  commonConstraints: string[];
  routingPreference?: string;
};

export type LearnedTaskMemory = {
  createdAt: string;
  goalFingerprint: string;
  goalPreview?: string;
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
  correction?: string;
  evidenceRefs?: string[];
  confidence?: number;
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
  failureClass: FailureClass;
  correction: string;
  evidenceRefs: string[];
  confidence: number;
  recurrence: number;
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

export async function appendLearnedTaskMemory(cwd: string, state: AgentGraphState): Promise<void> {
  const record: LearnedTaskMemory = {
    createdAt: new Date().toISOString(),
    goalFingerprint: fingerprintGoal(state.goal),
    goalPreview: clip(redactText(state.goal), 180),
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
  const failure = buildFailureMemoryFields(state, record);
  Object.assign(record, failure);
  const dir = path.join(cwd, ".tomorrowedge");
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "task-memory.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
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

export async function readLearnedTaskMemory(cwd: string, limit = 20): Promise<LearnedTaskMemory[]> {
  const filePath = path.join(cwd, ".tomorrowedge", "task-memory.jsonl");
  const content = await readFile(filePath, "utf8").catch(() => "");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LearnedTaskMemory)
    .slice(-limit)
    .reverse();
}

export async function readFailureMemories(cwd: string, limit = 20): Promise<FailureMemoryRecord[]> {
  const records = await readLearnedTaskMemory(cwd, Math.max(limit * 4, limit));
  const failures = records
    .filter((record) => Boolean(record.failureClass) || record.result === "failed" || record.result === "partially_completed" || record.result === "aborted")
    .map((record) => normalizeFailureRecord(record));
  const recurrence = new Map<string, number>();
  for (const record of failures) {
    const key = `${record.taskType}:${record.failureClass}`;
    recurrence.set(key, (recurrence.get(key) ?? 0) + 1);
  }
  return failures.map((record) => ({ ...record, recurrence: recurrence.get(`${record.taskType}:${record.failureClass}`) ?? 1 })).slice(0, limit);
}

export async function showFailureMemory(cwd: string, id: string): Promise<FailureMemoryRecord | undefined> {
  const records = await readFailureMemories(cwd, 200);
  return records.find((record) => record.id === id || record.goalFingerprint === id);
}

export async function explainFailureMemories(cwd: string, task: string, options: { limit?: number } = {}): Promise<FailureMemoryExplanation> {
  const records = await readFailureMemories(cwd, Math.max(options.limit ?? 5, 20));
  const taskSignals = tokenize(task);
  const selected: Array<FailureMemoryRecord & { score: number; matchedSignals: string[] }> = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const record of records) {
    const recordSignals = tokenize([
      record.goalPreview,
      record.taskType,
      record.riskLevel,
      record.failureClass,
      record.correction,
      ...(record.constraints ?? []),
      ...(record.verificationCommands ?? [])
    ].filter(Boolean).join(" "));
    const matchedSignals = [...taskSignals].filter((signal) => recordSignals.has(signal));
    const score =
      matchedSignals.length * 3 +
      (record.taskType !== "unknown" && taskSignals.has(record.taskType) ? 4 : 0) +
      (record.failureClass === "review_or_judge_blocked" && /review|judge|审查|裁决/i.test(task) ? 4 : 0) +
      (record.failureClass === "validation_failed" && /test|verify|验证|测试/i.test(task) ? 4 : 0) +
      Math.min(record.recurrence, 4);
    if (score >= 3) selected.push({ ...record, score, matchedSignals });
    else rejected.push({ id: record.id, reason: "low task-signal overlap" });
  }
  selected.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  return {
    task: clip(redactText(task), 180),
    selected: selected.slice(0, options.limit ?? 5),
    rejected: rejected.slice(0, 12)
  };
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
  return {
    failureClass,
    correction: correctionForFailure(failureClass, state, record),
    evidenceRefs,
    confidence: confidenceForFailure(failureClass, evidenceRefs)
  };
}

function normalizeFailureRecord(record: LearnedTaskMemory): FailureMemoryRecord {
  const failureClass = record.failureClass ?? classifyLegacyFailure(record);
  const evidenceRefs = record.evidenceRefs ?? [];
  return {
    ...record,
    id: failureMemoryId(record),
    failureClass,
    correction: record.correction ?? correctionForFailure(failureClass, undefined, record),
    evidenceRefs,
    confidence: record.confidence ?? confidenceForFailure(failureClass, evidenceRefs),
    recurrence: 1
  };
}

function failureMemoryId(record: LearnedTaskMemory): string {
  const stamp = record.createdAt.replace(/[-:.TZ]/g, "").slice(0, 14) || "unknown";
  return `${stamp}-${record.goalFingerprint}`;
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
      if ("selectedArtifacts" in event) values.push(...event.selectedArtifacts);
      if ("projectedArtifacts" in event) values.push(...event.projectedArtifacts);
      if ("supportingArtifacts" in event) values.push(...event.supportingArtifacts);
      return values;
    })
  ];
  return [...new Set(refs.map((ref) => redactText(ref)).filter(Boolean))].slice(0, 12);
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

const stopWords = new Set(["the", "and", "for", "with", "from", "this", "that", "task", "code", "file", "test", "fix", "add", "run"]);
