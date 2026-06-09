import type { RunResult } from "../../schemas/evidence.js";
import type { JudgeDecision } from "../../schemas/judge.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { ReviewReport } from "../../schemas/review.js";
import { redactText } from "../../safety/secretScanner.js";
import type { FailureClass, FailureMemoryExplanation, FailureMemoryRecord } from "./taskMemory.js";

export type MemoryConstraintKind =
  | "avoid_patch_pattern"
  | "verify_assumption"
  | "inspect_file"
  | "test_command"
  | "review_guard"
  | "repair_correction";

export type MemoryDerivedConstraint = {
  id: string;
  kind: MemoryConstraintKind;
  memoryId: string;
  failureClass: FailureClass;
  text: string;
  command?: string;
  confidence: number;
  score: number;
  evidenceRefs: string[];
  correctionStatus?: string;
  wrongAssumption?: string;
  correctedRule?: string;
  applicability: string[];
  counterexamples: string[];
};

export type FailureMemoryPremortem = {
  schemaVersion: "failure-memory-premortem/v1";
  task: string;
  selectedMemoryIds: string[];
  rejected: Array<{ id: string; reason: string }>;
  knownTraps: string[];
  avoidRules: string[];
  extraChecks: string[];
  constraints: MemoryDerivedConstraint[];
};

export type CandidateMemoryAssessment = {
  candidateId: string;
  memoryIds: string[];
  memoryViolations: string[];
  memoryAlignment: string[];
  penalty: number;
};

export type RepairMemoryContext = {
  schemaVersion: "failure-memory-repair/v1";
  query: string;
  selectedMemoryIds: string[];
  corrections: string[];
  counterexamples: string[];
  constraints: MemoryDerivedConstraint[];
};

export type FailureMemoryInfluenceState = {
  premortem?: FailureMemoryPremortem;
  coderConstraints: MemoryDerivedConstraint[];
  reviewAssessments: CandidateMemoryAssessment[];
  repairContext?: RepairMemoryContext;
};

type ScoredFailureMemory = FailureMemoryRecord & { score: number; matchedSignals: string[] };

export function emptyFailureMemoryInfluence(): FailureMemoryInfluenceState {
  return {
    coderConstraints: [],
    reviewAssessments: []
  };
}

export function buildFailureMemoryPremortem(task: string, explanation: FailureMemoryExplanation): FailureMemoryPremortem {
  const selected = explanation.selected as ScoredFailureMemory[];
  const constraints = selected.flatMap((record) => constraintsForRecord(record));
  return {
    schemaVersion: "failure-memory-premortem/v1",
    task: redactText(task),
    selectedMemoryIds: selected.map((record) => record.id),
    rejected: explanation.rejected,
    knownTraps: selected.map((record) => `${record.id}: ${record.failureClass} score=${record.score} status=${record.correctionStatus ?? "unknown"} - ${record.correctedRule ?? record.correction}`),
    avoidRules: constraints
      .filter((constraint) => constraint.kind === "avoid_patch_pattern" || constraint.kind === "review_guard")
      .map((constraint) => constraint.text),
    extraChecks: constraints
      .filter((constraint) => constraint.kind === "test_command" || constraint.kind === "verify_assumption" || constraint.kind === "inspect_file")
      .map((constraint) => constraint.command ?? constraint.text),
    constraints
  };
}

export function applyPremortemToPlan(plan: Plan, premortem: FailureMemoryPremortem): Plan {
  if (!premortem.constraints.length) return plan;
  const memoryConstraints = premortem.constraints.map((constraint) => `Memory pre-mortem: ${constraint.text}`);
  const memoryChecks = premortem.constraints
    .filter((constraint) => constraint.kind === "test_command" && constraint.command)
    .map((constraint) => constraint.command!);
  return {
    ...plan,
    constraints: uniqueStrings([...(plan.constraints ?? []), ...memoryConstraints]),
    verificationCommands: uniqueStrings([...(plan.verificationCommands ?? []), ...memoryChecks]),
    acceptanceCriteria: uniqueStrings([...(plan.acceptanceCriteria ?? []), ...premortem.extraChecks.map((check) => `Memory check: ${check}`)])
  };
}

export function coderConstraintsFromPremortem(premortem?: FailureMemoryPremortem): MemoryDerivedConstraint[] {
  return (premortem?.constraints ?? []).filter((constraint) =>
    constraint.kind === "avoid_patch_pattern" ||
    constraint.kind === "verify_assumption" ||
    constraint.kind === "inspect_file" ||
    constraint.kind === "test_command"
  );
}

export function applyCoderConstraintsToCandidate(candidate: PatchCandidate, constraints: MemoryDerivedConstraint[]): PatchCandidate {
  if (!constraints.length) return candidate;
  return {
    ...candidate,
    testPlan: uniqueStrings([
      ...candidate.testPlan,
      ...constraints.filter((constraint) => constraint.kind === "test_command" && constraint.command).map((constraint) => constraint.command!)
    ]),
    knownTradeoffs: uniqueStrings([
      ...candidate.knownTradeoffs,
      ...constraints.slice(0, 6).map((constraint) => `Memory constraint ${constraint.memoryId}: ${constraint.text}`)
    ])
  };
}

export function buildCandidateMemoryAssessments(candidates: PatchCandidate[], constraints: MemoryDerivedConstraint[]): CandidateMemoryAssessment[] {
  const relevant = constraints.filter((constraint) => constraint.kind !== "repair_correction");
  if (!relevant.length) return [];
  return candidates.map((candidate) => {
    const violations: string[] = [];
    const alignment: string[] = [];
    const requiredCommands = relevant.filter((constraint) => constraint.kind === "test_command" && constraint.command).map((constraint) => constraint.command!);
    for (const command of requiredCommands) {
      if (!candidate.testPlan.includes(command)) violations.push(`missing memory-required verifier: ${command}`);
      else alignment.push(`keeps memory-required verifier: ${command}`);
    }
    if (!candidate.unifiedDiff.trim() && relevant.some((constraint) => constraint.kind === "avoid_patch_pattern" || constraint.kind === "verify_assumption")) {
      violations.push("no concrete diff to validate against retrieved failure memories");
    }
    if (candidate.unifiedDiff.trim() && !violations.length) {
      alignment.push("candidate is inspectable against retrieved failure memories");
    }
    const memoryIds = uniqueStrings(relevant.map((constraint) => constraint.memoryId));
    return {
      candidateId: candidate.candidateId,
      memoryIds,
      memoryViolations: violations,
      memoryAlignment: alignment,
      penalty: violations.length * 15
    };
  });
}

export function applyMemoryAssessmentsToReview(report: ReviewReport, assessments: CandidateMemoryAssessment[]): ReviewReport {
  if (!assessments.length) return report;
  const byCandidate = new Map(assessments.map((assessment) => [assessment.candidateId, assessment]));
  return {
    ...report,
    reviews: report.reviews.map((review) => {
      const assessment = byCandidate.get(review.candidateId);
      if (!assessment) return review;
      const hasViolation = assessment.memoryViolations.length > 0;
      return {
        ...review,
        correctnessScore: Math.max(0, review.correctnessScore - assessment.penalty),
        riskScore: Math.min(100, review.riskScore + assessment.penalty),
        regressionConcerns: uniqueStrings([
          ...review.regressionConcerns,
          ...assessment.memoryViolations.map((violation) => `memory_violation: ${violation}`)
        ]),
        recommendation: hasViolation ? downgradeRecommendation(review.recommendation) : review.recommendation,
        notes: uniqueStrings([
          ...review.notes,
          ...assessment.memoryAlignment.map((item) => `memory_alignment: ${item}`),
          ...(hasViolation ? [`Memory guard used ${assessment.memoryIds.join(", ")}`] : [])
        ]),
        memoryViolations: assessment.memoryViolations,
        memoryAlignment: assessment.memoryAlignment,
        memoryIds: assessment.memoryIds
      };
    }),
    overallRecommendation: assessments.some((assessment) => assessment.memoryViolations.length)
      ? `${report.overallRecommendation} Memory guard found candidate risks.`
      : `${report.overallRecommendation} Memory guard found no repeated known trap.`
  };
}

export function applyMemoryAssessmentsToJudge(judge: JudgeDecision, assessments: CandidateMemoryAssessment[]): JudgeDecision {
  if (!assessments.length) return judge;
  const selectedAssessment = judge.selectedCandidateId ? assessments.find((assessment) => assessment.candidateId === judge.selectedCandidateId) : undefined;
  if (selectedAssessment?.memoryViolations.length) {
    return {
      decision: "request_revision",
      reason: `Memory guard blocked ${judge.selectedCandidateId}: ${selectedAssessment.memoryViolations.join("; ")}. Memory ids: ${selectedAssessment.memoryIds.join(", ")}.`,
      confidence: Math.max(0.62, judge.confidence)
    };
  }
  const touchedIds = uniqueStrings(assessments.flatMap((assessment) => assessment.memoryIds));
  if (!touchedIds.length) return judge;
  return {
    ...judge,
    reason: `${judge.reason} Memory guard checked retrieved memories: ${touchedIds.slice(0, 5).join(", ")}.`
  };
}

export function buildRepairMemoryQuery(plan: Plan, failedRun: RunResult, appliedFiles: string[]): string {
  return redactText([
    plan.goal,
    `failed command: ${failedRun.command}`,
    `exit code: ${failedRun.exitCode}`,
    failedRun.stderr,
    failedRun.stdout,
    `applied files: ${appliedFiles.join(", ")}`
  ].filter(Boolean).join("\n"));
}

export function buildRepairMemoryContext(query: string, explanation: FailureMemoryExplanation): RepairMemoryContext {
  const selected = explanation.selected as ScoredFailureMemory[];
  const constraints = selected.flatMap((record) => constraintsForRecord(record, "repair_correction"));
  return {
    schemaVersion: "failure-memory-repair/v1",
    query: redactText(query),
    selectedMemoryIds: selected.map((record) => record.id),
    corrections: selected.map((record) => `${record.id} [${record.correctionStatus ?? "unknown"}]: ${record.correctedRule ?? record.correction}`),
    counterexamples: selected.flatMap((record) => record.counterexamples?.length ? record.counterexamples.map((item) => `${record.id}: ${item}`) : [`${record.id}: avoid repeating ${record.failureClass}`]),
    constraints
  };
}

export function applyRepairMemoryContextToCandidate(candidate: PatchCandidate, context?: RepairMemoryContext): PatchCandidate {
  if (!context?.constraints.length) return candidate;
  return {
    ...candidate,
    testPlan: uniqueStrings([
      ...candidate.testPlan,
      ...context.constraints.filter((constraint) => constraint.kind === "test_command" && constraint.command).map((constraint) => constraint.command!)
    ]),
    knownTradeoffs: uniqueStrings([
      ...candidate.knownTradeoffs,
      ...context.corrections.slice(0, 4).map((correction) => `Retrieved repair correction: ${correction}`)
    ])
  };
}

function constraintsForRecord(record: ScoredFailureMemory, overrideKind?: MemoryConstraintKind): MemoryDerivedConstraint[] {
  const commands = record.verificationCommands?.length ? record.verificationCommands : [];
  const constraints: MemoryDerivedConstraint[] = commands.map((command) => ({
    id: `${record.id}:test:${command}`,
    kind: "test_command",
    memoryId: record.id,
    failureClass: record.failureClass,
    text: `Run or preserve verifier '${command}' because similar failures ended as ${record.failureClass}.`,
    command,
    confidence: record.confidence,
    score: record.score,
    evidenceRefs: record.evidenceRefs,
    correctionStatus: record.correctionStatus,
    wrongAssumption: record.wrongAssumption,
    correctedRule: record.correctedRule,
    applicability: record.applicability ?? [],
    counterexamples: record.counterexamples ?? []
  }));
  const kind = overrideKind ?? kindForFailure(record.failureClass);
  constraints.push({
    id: `${record.id}:${kind}`,
    kind,
    memoryId: record.id,
    failureClass: record.failureClass,
    text: textForFailure(record),
    confidence: record.confidence,
    score: record.score,
    evidenceRefs: record.evidenceRefs,
    correctionStatus: record.correctionStatus,
    wrongAssumption: record.wrongAssumption,
    correctedRule: record.correctedRule,
    applicability: record.applicability ?? [],
    counterexamples: record.counterexamples ?? []
  });
  return constraints;
}

function kindForFailure(failureClass: FailureClass): MemoryConstraintKind {
  switch (failureClass) {
    case "validation_failed":
      return "verify_assumption";
    case "review_or_judge_blocked":
      return "review_guard";
    case "no_candidate_selected":
    case "partial_completion":
    case "workflow_incomplete":
      return "avoid_patch_pattern";
    case "environment_failure":
    case "provider_failure":
    case "routing_blocked":
      return "inspect_file";
    case "coding_error":
      return "avoid_patch_pattern";
  }
}

function textForFailure(record: ScoredFailureMemory): string {
  const correction = correctionSummary(record);
  switch (record.failureClass) {
    case "validation_failed":
      return `Do not rely on the patch until the failing verifier is reproduced and rerun. ${correction}`;
    case "review_or_judge_blocked":
      return `Resolve the prior review/judge blocking concern before selection. ${correction}`;
    case "no_candidate_selected":
    case "partial_completion":
    case "workflow_incomplete":
      return `Avoid opaque or incomplete candidates; produce an inspectable diff and stop reason. ${correction}`;
    case "environment_failure":
      return `Separate local environment/tooling failures from patch quality. ${correction}`;
    case "provider_failure":
    case "routing_blocked":
      return `Check provider/routing health before blaming implementation. ${correction}`;
    case "coding_error":
      return `Avoid repeating the prior coding trap; keep the patch narrow and evidence-backed. ${correction}`;
  }
}

function correctionSummary(record: ScoredFailureMemory): string {
  const pieces = [
    `Correction(${record.correctionStatus ?? "unknown"}): ${record.correctedRule ?? record.correction}`,
    record.wrongAssumption ? `Wrong assumption: ${record.wrongAssumption}` : "",
    record.applicability?.length ? `Applies when: ${record.applicability.slice(0, 4).join(", ")}` : ""
  ].filter(Boolean);
  return pieces.join(" ");
}

function downgradeRecommendation(value: ReviewReport["reviews"][number]["recommendation"]): ReviewReport["reviews"][number]["recommendation"] {
  if (value === "accept") return "revise";
  if (value === "accept_with_minor_change") return "revise";
  return value === "revise" ? "reject" : value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
