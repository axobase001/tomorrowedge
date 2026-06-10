import type { JudgeDecision } from "../../../schemas/judge.js";
import type { Plan } from "../../../schemas/plan.js";
import type { ReviewReport } from "../../../schemas/review.js";
import { makeId } from "../../../utils/ids.js";
import { parseTaskGraphCandidate, validateTaskGraph } from "../../planning/taskGraphValidator.js";
import type { ExternalAgentAdapterRuntime, ExternalAgentEvidenceInput, ExternalAgentOutputInput, ExternalAgentPromptInput } from "./externalAgentAdapter.js";
import { estimateExternalCost, normalizeGenericExternalAgentResult, type ExternalAgentNormalizationInput, type ExternalAgentNormalizationResult } from "./genericExternalAgentAdapter.js";

export const claudeCodeExternalAgentAdapter: ExternalAgentAdapterRuntime = {
  id: "claude_code",
  supports: (profile) => profile.adapter === "claude_code" || /claude/i.test(`${profile.id} ${profile.name}`),
  buildPrompt: buildClaudePrompt,
  normalizeOutput: normalizeClaudeOutput,
  extractEvidence: extractClaudeEvidence,
  detectFailure: (input) => {
    if (input.normalized.status === "failed") {
      return { failed: true, reason: input.normalized.warnings.join("; ") || "Claude Code output failed typed normalization.", retryable: true, category: "malformed_output" };
    }
    if ((input.role === "core" || input.role === "planner") && !planFromPayload(input.normalized.payload)) {
      return { failed: true, reason: "Claude planner output did not contain a plan.", retryable: true, category: "missing_contract" };
    }
    if (input.role === "judge" && !judgmentFromPayload(input.normalized.payload)) {
      return { failed: true, reason: "Claude judge output did not contain a judgment.", retryable: true, category: "missing_contract" };
    }
    if (input.role === "reviewer" && !reviewFromPayload(input.normalized.payload)) {
      return { failed: true, reason: "Claude reviewer output did not contain review data.", retryable: true, category: "missing_contract" };
    }
    return { failed: false };
  },
  retryPolicy: ({ failure, attempt }) => ({
    retry: Boolean(failure.retryable && attempt < 2),
    reason: failure.reason ?? "Claude Code adapter retry policy"
  }),
  estimateCost: estimateExternalCost
};

export function normalizeClaudeCodeExternalAgentResult(input: ExternalAgentNormalizationInput): ExternalAgentNormalizationResult {
  return claudeCodeExternalAgentAdapter.normalizeOutput({ ...input, adapter: "claude_code", responseMode: input.responseMode ?? "mixed", profile: claudeProfileForLegacy(input) });
}

function buildClaudePrompt(input: ExternalAgentPromptInput): string {
  return [
    "You are Claude Code connected to TomorrowEdge as a scarce strong-agent role.",
    "Your job is not to produce an opaque answer. Produce a typed role output for the cockpit ledger.",
    `Role: ${input.role}`,
    `Output contract: ${input.envelope.outputContract}`,
    roleInstructions(input.role),
    "",
    "Return strict JSON. Include no markdown fences.",
    "Task envelope:",
    JSON.stringify(input.envelope, null, 2),
    "",
    "Original user-facing prompt:",
    input.prompt
  ].join("\n");
}

function roleInstructions(role: string): string {
  if (role === "core" || role === "planner") {
    return [
      "Planner contract:",
      "{ \"summary\": string, \"plan\": { goal, constraints, riskLevel, taskType, workflowKind, steps, expectedFiles?, verificationCommands?, debateRecommended, reasonForDebate?, taskGraph? } }",
      "If taskGraph is provided, every node must include ownerRole, dependencies/dependsOn, phase, required evidence, status, and mutationAllowed."
    ].join("\n");
  }
  if (role === "reviewer") {
    return "Reviewer contract: { \"summary\": string, \"review\": { \"mode\": \"standard\"|\"red_team\", \"reviews\": CandidateReview[], \"overallRecommendation\": string }, \"issues\"?: DebateIssue[] }";
  }
  if (role === "judge") {
    return "Judge contract: { \"summary\": string, \"judgment\": { \"decision\": \"select\"|\"request_revision\"|\"ask_user\"|\"abort\", \"selectedCandidateId\"?, \"reason\": string, \"confidence\": number, \"unresolvedIssueIds\"?: string[] } }";
  }
  return "Use the generic TomorrowEdge typed role contract.";
}

function normalizeClaudeOutput(input: ExternalAgentOutputInput): ExternalAgentNormalizationResult {
  const generic = normalizeGenericExternalAgentResult({ ...input, adapter: "claude_code", responseMode: input.responseMode ?? "mixed" });
  let payload = generic.payload;
  const warnings = [...generic.warnings];

  if (input.role === "core" || input.role === "planner") {
    const plan = planFromPayload(payload);
    if (plan) {
      payload = { summary: summaryFromPayload(payload, "Claude Code planner normalized plan output."), plan };
      const taskGraph = plan.taskGraph;
      if (taskGraph) {
        const validation = validateTaskGraph(taskGraph);
        if (!validation.valid) warnings.push(`taskGraph validation: ${validation.errors.join("; ")}`);
      }
      return { ...generic, status: warnings.length ? "warning" : "success", warnings, payload, summary: summaryFromPayload(payload, "Claude Code planner normalized plan output.") };
    }
    warnings.push("Claude planner output did not include plan/steps.");
  } else if (input.role === "reviewer") {
    const review = reviewFromPayload(payload);
    if (review) {
      payload = { summary: summaryFromPayload(payload, "Claude Code reviewer normalized review output."), review, issues: asRecord(payload)?.issues ?? [] };
      return { ...generic, status: warnings.length ? "warning" : "success", warnings, payload, summary: summaryFromPayload(payload, "Claude Code reviewer normalized review output.") };
    }
    warnings.push("Claude reviewer output did not include review/reviews.");
  } else if (input.role === "judge") {
    const judgment = judgmentFromPayload(payload);
    if (judgment) {
      payload = { summary: judgment.reason, judgment };
      return { ...generic, status: warnings.length ? "warning" : "success", warnings, payload, summary: judgment.reason };
    }
    warnings.push("Claude judge output did not include judgment/decision.");
  }

  const strict = input.normalizationStrictness === "strict";
  const status = (strict || input.strictJson) && warnings.length ? "failed" : warnings.length ? "warning" : generic.status;
  return {
    ...generic,
    status,
    warnings,
    payload,
    summary: generic.summary.startsWith("External") ? `Claude Code adapter normalized ${input.role} ${input.outputContract} output.` : generic.summary
  };
}

function extractClaudeEvidence(input: ExternalAgentEvidenceInput): string[] {
  const evidence: string[] = [];
  const plan = planFromPayload(input.normalized.payload);
  if (plan) {
    evidence.push(`claude_plan_steps=${plan.steps.length}`);
    evidence.push(`claude_plan_risk=${plan.riskLevel}`);
    if (plan.taskGraph) evidence.push(`claude_task_graph_nodes=${plan.taskGraph.nodes.length}`);
  }
  const review = reviewFromPayload(input.normalized.payload);
  if (review) evidence.push(`claude_review_count=${review.reviews.length}`);
  const judgment = judgmentFromPayload(input.normalized.payload);
  if (judgment) {
    evidence.push(`claude_judgment=${judgment.decision}`);
    if (judgment.unresolvedIssueIds?.length) evidence.push(`claude_unresolved_issues=${judgment.unresolvedIssueIds.join(",")}`);
  }
  if (input.normalized.warnings.length) evidence.push(`claude_normalization_warnings=${input.normalized.warnings.join("; ")}`);
  return evidence;
}

function planFromPayload(payload: unknown): Plan | undefined {
  const object = asRecord(payload);
  const planObject = asRecord(object?.plan) ?? object;
  const steps = Array.isArray(planObject?.steps) ? planObject.steps.map(normalizeStep).filter(isDefined) : [];
  if (!steps.length && !asRecord(planObject?.taskGraph)) return undefined;
  const taskGraph = parseTaskGraphCandidate(planObject?.taskGraph);
  return {
    goal: stringOrUndefined(planObject?.goal) ?? stringOrUndefined(object?.goal) ?? "External Claude Code plan",
    constraints: stringArray(planObject?.constraints),
    riskLevel: planObject?.riskLevel === "high" || planObject?.riskLevel === "medium" ? planObject.riskLevel : "low",
    taskType: taskType(planObject?.taskType),
    workflowKind: typeof planObject?.workflowKind === "string" ? planObject.workflowKind as Plan["workflowKind"] : undefined,
    requiresPatchWorkflow: booleanOrUndefined(planObject?.requiresPatchWorkflow),
    allowedPhases: Array.isArray(planObject?.allowedPhases) ? planObject.allowedPhases as Plan["allowedPhases"] : undefined,
    acceptanceCriteria: stringArray(planObject?.acceptanceCriteria),
    steps: steps.length ? steps : [{
      id: "external_task_graph",
      title: "Use external TaskGraph",
      detail: "Claude Code provided a TaskGraph without explicit plan steps.",
      status: "pending"
    }],
    taskGraph: taskGraph ?? undefined,
    expectedFiles: stringArray(planObject?.expectedFiles),
    verificationCommands: stringArray(planObject?.verificationCommands),
    debateRecommended: Boolean(planObject?.debateRecommended),
    reasonForDebate: stringOrUndefined(planObject?.reasonForDebate)
  };
}

function normalizeStep(value: unknown): Plan["steps"][number] | undefined {
  const step = asRecord(value);
  if (!step) return undefined;
  return {
    id: stringOrUndefined(step.id) ?? makeId("external_step"),
    title: stringOrUndefined(step.title) ?? "External plan step",
    detail: stringOrUndefined(step.detail) ?? stringOrUndefined(step.objective) ?? "No detail provided.",
    status: step.status === "running" || step.status === "done" || step.status === "blocked" ? step.status : "pending"
  };
}

function reviewFromPayload(payload: unknown): ReviewReport | undefined {
  const object = asRecord(payload);
  const reviewObject = asRecord(object?.review) ?? object;
  const reviews = Array.isArray(reviewObject?.reviews) ? reviewObject.reviews.map(normalizeReviewItem).filter(isDefined) : [];
  if (!reviews.length) return undefined;
  return {
    mode: reviewObject?.mode === "red_team" ? "red_team" : "standard",
    reviews,
    overallRecommendation: stringOrUndefined(reviewObject?.overallRecommendation) ?? stringOrUndefined(object?.summary) ?? "External Claude Code review normalized."
  };
}

function normalizeReviewItem(value: unknown): ReviewReport["reviews"][number] | undefined {
  const item = asRecord(value);
  if (!item) return undefined;
  return {
    candidateId: stringOrUndefined(item.candidateId) ?? "candidate",
    correctnessScore: boundedScore(item.correctnessScore, 50),
    riskScore: boundedScore(item.riskScore, 50),
    invasiveness: item.invasiveness === "high" || item.invasiveness === "medium" ? item.invasiveness : "low",
    testCoverage: item.testCoverage === "strong" || item.testCoverage === "adequate" || item.testCoverage === "weak" ? item.testCoverage : "none",
    securityConcerns: stringArray(item.securityConcerns),
    regressionConcerns: stringArray(item.regressionConcerns),
    redTeamFindings: [],
    recommendation: recommendation(item.recommendation),
    notes: stringArray(item.notes)
  };
}

function judgmentFromPayload(payload: unknown): JudgeDecision | undefined {
  const object = asRecord(payload);
  const judgment = asRecord(object?.judgment) ?? object;
  if (!judgment) return undefined;
  const decision = judgment?.decision;
  if (decision !== "select" && decision !== "request_revision" && decision !== "ask_user" && decision !== "abort") return undefined;
  return {
    selectedCandidateId: stringOrUndefined(judgment.selectedCandidateId),
    decision,
    reason: stringOrUndefined(judgment.reason) ?? stringOrUndefined(object?.summary) ?? "Claude Code judge normalized judgment.",
    borrowIdeasFromOtherCandidates: stringArray(judgment.borrowIdeasFromOtherCandidates),
    acceptedClaims: stringArray(judgment.acceptedClaims),
    rejectedClaims: stringArray(judgment.rejectedClaims),
    unresolvedBlockingIssues: stringArray(judgment.unresolvedBlockingIssues),
    unresolvedIssueIds: stringArray(judgment.unresolvedIssueIds),
    evidenceCoverageScore: boundedScore(judgment.evidenceCoverageScore, 0),
    confidence: typeof judgment.confidence === "number" ? Math.max(0, Math.min(1, judgment.confidence)) : 0.65,
    requiredUserDecision: stringOrUndefined(judgment.requiredUserDecision)
  };
}

function claudeProfileForLegacy(input: ExternalAgentNormalizationInput) {
  return {
    id: input.externalAgentId,
    name: "Claude Code",
    transport: "mcp" as const,
    adapter: "claude_code" as const,
    responseMode: input.responseMode,
    strictJson: input.strictJson,
    normalizationStrictness: input.normalizationStrictness,
    capabilities: [],
    allowedRoles: [input.role],
    trustLevel: "high" as const
  };
}

function taskType(value: unknown): Plan["taskType"] {
  return value === "bugfix" || value === "feature" || value === "refactor" || value === "test" || value === "docs" || value === "analysis" ? value : "unknown";
}

function recommendation(value: unknown): ReviewReport["reviews"][number]["recommendation"] {
  return value === "accept" || value === "accept_with_minor_change" || value === "reject" || value === "revise" ? value : "revise";
}

function boundedScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function summaryFromPayload(payload: unknown, fallback: string): string {
  return stringOrUndefined(asRecord(payload)?.summary) ?? fallback;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
