import type { ObjectiveTraceV1 } from "../traces/objectiveTrace.js";
import { evaluatePolicyFitness, type PolicyFitness } from "./policyEvaluator.js";
import type { OrchestrationPolicyGenome } from "./orchestrationPolicy.js";

export type PolicyCounterfactualReplay = {
  policyId: string;
  traceId: string;
  originalStatus: ObjectiveTraceV1["outcome"]["finalStatus"];
  simulatedStatus: ObjectiveTraceV1["outcome"]["finalStatus"];
  decisions: CounterfactualDecision[];
  fitness: PolicyFitness;
  baselineFitness?: PolicyFitness;
  deltas: {
    finalFitness?: number;
    evidenceScore: number;
    traceCompletenessScore: number;
    costPenalty: number;
    riskPenalty: number;
  };
  summary: string;
};

export type CounterfactualDecision = {
  phase: "planning" | "coding" | "review" | "judge" | "repair" | "summary";
  role?: string;
  actualDecision: string;
  policyDecision: string;
  changed: boolean;
  predictedImpact: "quality_up" | "quality_down" | "cost_up" | "cost_down" | "risk_down" | "risk_up" | "neutral";
  reason: string;
};

export type PolicyTournamentResult = {
  winnerPolicyId: string;
  evaluatedPolicies: number;
  traceCount: number;
  ranking: Array<{
    policyId: string;
    averageFitness: number;
    wins: number;
  }>;
};

export function simulatePolicyOnTrace(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1, baselinePolicy?: OrchestrationPolicyGenome): PolicyCounterfactualReplay {
  const projectedTrace = projectTraceForPolicy(policy, trace);
  const decisions = buildCounterfactualDecisions(policy, trace);
  applyDecisionImpacts(projectedTrace, decisions);
  const fitness = evaluatePolicyFitness(policy, projectedTrace);
  const baselineFitness = baselinePolicy ? evaluatePolicyFitness(baselinePolicy, trace) : undefined;
  const simulatedStatus = simulatedStatusForPolicy(policy, projectedTrace);
  return {
    policyId: policy.policyId,
    traceId: trace.traceId,
    originalStatus: trace.outcome.finalStatus,
    simulatedStatus,
    decisions,
    fitness,
    baselineFitness,
    deltas: {
      finalFitness: baselineFitness ? fitness.finalFitness - baselineFitness.finalFitness : undefined,
      evidenceScore: fitness.evidenceScore - trace.evidenceSummary.evidenceScore,
      traceCompletenessScore: fitness.traceCompletenessScore - (trace.traceCompleteness?.score ?? trace.evidenceSummary.evidenceScore),
      costPenalty: fitness.costPenalty - (baselineFitness?.costPenalty ?? 0),
      riskPenalty: fitness.riskPenalty - (baselineFitness?.riskPenalty ?? 0)
    },
    summary: `${policy.policyId} projects ${trace.traceId} as ${simulatedStatus} with fitness=${fitness.finalFitness}; changed decisions=${decisions.filter((decision) => decision.changed).length}.`
  };
}

export function runPolicyTournament(policies: OrchestrationPolicyGenome[], traces: ObjectiveTraceV1[]): PolicyTournamentResult {
  const scored = policies.map((policy) => {
    const replays = traces.map((trace) => simulatePolicyOnTrace(policy, trace));
    const averageFitness = replays.length ? Math.round(replays.reduce((sum, replay) => sum + replay.fitness.finalFitness, 0) / replays.length) : 0;
    return { policyId: policy.policyId, averageFitness, wins: 0 };
  });
  for (const trace of traces) {
    const best = policies
      .map((policy) => simulatePolicyOnTrace(policy, trace))
      .sort((left, right) => right.fitness.finalFitness - left.fitness.finalFitness)[0];
    const row = scored.find((item) => item.policyId === best?.policyId);
    if (row) row.wins += 1;
  }
  const ranking = scored.sort((left, right) => right.averageFitness - left.averageFitness || right.wins - left.wins);
  return {
    winnerPolicyId: ranking[0]?.policyId ?? "none",
    evaluatedPolicies: policies.length,
    traceCount: traces.length,
    ranking
  };
}

function projectTraceForPolicy(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1): ObjectiveTraceV1 {
  const next = structuredClone(trace);
  if (policy.verificationPolicy.verificationStrictness === "strict" || policy.stopPolicy.stopMode === "evidence_strict") {
    const missing = new Set(next.evidenceSummary.missingEvidence);
    if (!next.evidenceSummary.evidencePacketRefs.length) missing.add("evidence packet");
    if ((next.traceCompleteness?.score ?? 0) < 90) missing.add("trace completeness");
    next.evidenceSummary.missingEvidence = [...missing];
    next.evidenceSummary.evidenceScore = Math.min(next.evidenceSummary.evidenceScore, next.evidenceSummary.missingEvidence.length ? 65 : 100);
  }
  if (policy.contractPolicy.contractDepth === "light" && policy.verificationPolicy.verificationStrictness === "light") {
    next.evidenceSummary.evidenceScore = Math.max(next.evidenceSummary.evidenceScore, 70);
  }
  if (policy.routingPolicy.routingPreference === "cheap") {
    next.costSummary.estimatedCostUsd = (next.costSummary.estimatedCostUsd ?? 0.1) * 0.7;
  }
  if (policy.routingPolicy.routingPreference === "quality") {
    next.costSummary.estimatedCostUsd = (next.costSummary.estimatedCostUsd ?? 0.1) * 1.15;
  }
  return next;
}

function simulatedStatusForPolicy(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1): ObjectiveTraceV1["outcome"]["finalStatus"] {
  if (trace.contractVerification.status === "failed") return "unsafe";
  const missing = trace.evidenceSummary.missingEvidence.length;
  const strict = policy.verificationPolicy.verificationStrictness === "strict" || policy.stopPolicy.stopMode === "evidence_strict";
  if (strict && missing) return policy.stopPolicy.allowPartialCompletion ? "partial" : "failure";
  if (trace.outcome.finalStatus === "partial" && !policy.stopPolicy.allowPartialCompletion) return "failure";
  return trace.outcome.finalStatus;
}

function buildCounterfactualDecisions(policy: OrchestrationPolicyGenome, trace: ObjectiveTraceV1): CounterfactualDecision[] {
  const rolesUsed = new Set(trace.roleGraphSummary.rolesUsed);
  const highRisk = trace.contract.riskLevel === "high" || trace.contract.reasoningSensitivity === "high";
  const mediumOrHighRisk = highRisk || trace.contract.riskLevel === "medium" || trace.contract.reasoningSensitivity === "medium";
  const patchLike = ["patch", "repair", "vision_patch"].includes(trace.contract.workflowKind);
  const missingEvidence = trace.evidenceSummary.missingEvidence.length > 0;
  const unresolvedIssue = hasUnresolvedIssueSignal(trace);
  const actualHasRepair = trace.repairSummary.repairAttempts > 0;
  const actualCost = trace.costSummary.estimatedCostUsd ?? 0;
  const decisions: CounterfactualDecision[] = [];

  const requireReviewer = highRisk
    ? policy.verificationPolicy.requireReviewerForHighRisk || thresholdAtMost(policy.routingPolicy.reviewerThreshold, "high")
    : patchLike && thresholdAtMost(policy.routingPolicy.reviewerThreshold, "medium");
  decisions.push(decision({
    phase: "review",
    role: "reviewer",
    actual: rolesUsed.has("reviewer") ? "reviewer_required" : "reviewer_not_required",
    policy: requireReviewer ? "reviewer_required" : "reviewer_not_required",
    impact: requireReviewer ? "risk_down" : "cost_down",
    reason: requireReviewer ? `reviewerThreshold=${policy.routingPolicy.reviewerThreshold}; highRisk=${highRisk}` : `policy allows reviewer omission for risk=${trace.contract.riskLevel}`
  }));

  const requireJudge = highRisk
    ? thresholdAtMost(policy.routingPolicy.judgeThreshold, "high") || policy.stopPolicy.escalateWhenAmbiguous
    : patchLike && policy.routingPolicy.judgeThreshold === "medium";
  decisions.push(decision({
    phase: "judge",
    role: "judge",
    actual: rolesUsed.has("judge") ? "judge_required" : "judge_not_required",
    policy: requireJudge ? "judge_required" : "judge_not_required",
    impact: requireJudge ? "risk_down" : "cost_down",
    reason: requireJudge ? `judgeThreshold=${policy.routingPolicy.judgeThreshold}; stopMode=${policy.stopPolicy.stopMode}` : "policy does not require judge for this risk/workflow"
  }));

  decisions.push(decision({
    phase: "coding",
    role: "coder_b",
    actual: rolesUsed.has("coder_b") ? "coder_b_allowed" : "coder_b_not_used",
    policy: policy.planningPolicy.allowParallelRoles ? "coder_b_allowed" : "coder_b_forbidden",
    impact: policy.planningPolicy.allowParallelRoles ? "quality_up" : "cost_down",
    reason: `planningPolicy.allowParallelRoles=${policy.planningPolicy.allowParallelRoles}`
  }));

  const requireDebate = Boolean(policy.debatePolicy && policy.debatePolicy.maxStructuredRounds > 0 && (mediumOrHighRisk || missingEvidence || unresolvedIssue));
  decisions.push(decision({
    phase: "review",
    role: "reviewer",
    actual: trace.roleGraphSummary.rolesUsed.includes("judge") && trace.evidenceSummary.evidencePacketRefs.length ? "debate_possible" : "debate_not_recorded",
    policy: requireDebate ? "debate_required" : "debate_not_required",
    impact: requireDebate ? "quality_up" : "cost_down",
    reason: `debate rounds=${policy.debatePolicy?.maxStructuredRounds ?? 0}; missingEvidence=${missingEvidence}; unresolvedIssue=${unresolvedIssue}`
  }));

  decisions.push(decision({
    phase: "repair",
    role: "repairer",
    actual: actualHasRepair ? "repair_used" : "repair_not_used",
    policy: policy.repairPolicy.maxRepairRounds > 0 && (missingEvidence || trace.verificationSummary.status === "failure") ? "repair_allowed" : "repair_blocked",
    impact: policy.repairPolicy.maxRepairRounds > 0 ? "quality_up" : "cost_down",
    reason: `maxRepairRounds=${policy.repairPolicy.maxRepairRounds}; retryOnFailedVerification=${policy.repairPolicy.retryOnFailedVerification}`
  }));

  decisions.push(decision({
    phase: "summary",
    role: "summarizer",
    actual: trace.outcome.finalStatus === "partial" ? "partial_stop" : "final_stop",
    policy: policy.stopPolicy.stopMode === "early" ? "early_stop" : policy.stopPolicy.stopMode === "evidence_strict" ? "evidence_strict_stop" : "balanced_stop",
    impact: policy.stopPolicy.stopMode === "early" ? "cost_down" : policy.stopPolicy.stopMode === "evidence_strict" ? "risk_down" : "neutral",
    reason: `stopMode=${policy.stopPolicy.stopMode}; allowPartial=${policy.stopPolicy.allowPartialCompletion}`
  }));

  const preferExternalStrong = policy.routingPolicy.routingPreference === "quality" && (highRisk || trace.contract.userScenario.ambiguityLevel !== "low");
  decisions.push(decision({
    phase: "review",
    role: "reviewer",
    actual: trace.roleGraphSummary.routingDecisions.some((item) => /external:/.test(item)) ? "external_strong_agent_used" : "native_or_provider_agent_used",
    policy: preferExternalStrong ? "external_reviewer_or_judge_preferred" : "external_strong_agent_not_preferred",
    impact: preferExternalStrong ? "cost_up" : actualCost > 0.2 ? "cost_down" : "neutral",
    reason: `routingPreference=${policy.routingPolicy.routingPreference}; ambiguity=${trace.contract.userScenario.ambiguityLevel}`
  }));

  decisions.push(decision({
    phase: "judge",
    role: "judge",
    actual: unresolvedIssue ? "unresolved_issue_present" : "no_unresolved_issue_signal",
    policy: policy.debatePolicy?.blockOnUnresolvedCritical ? "block_unresolved_debate_issue" : "allow_unresolved_debate_issue",
    impact: policy.debatePolicy?.blockOnUnresolvedCritical ? "risk_down" : "risk_up",
    reason: `blockOnUnresolvedCritical=${policy.debatePolicy?.blockOnUnresolvedCritical ?? false}`
  }));

  return decisions;
}

function applyDecisionImpacts(trace: ObjectiveTraceV1, decisions: CounterfactualDecision[]): void {
  for (const decision of decisions.filter((item) => item.changed)) {
    if (decision.predictedImpact === "risk_down") {
      trace.evidenceSummary.evidenceScore = Math.min(100, trace.evidenceSummary.evidenceScore + 4);
      if (trace.traceCompleteness) trace.traceCompleteness.score = Math.min(100, trace.traceCompleteness.score + 3);
    }
    if (decision.predictedImpact === "risk_up") {
      trace.evidenceSummary.evidenceScore = Math.max(0, trace.evidenceSummary.evidenceScore - 6);
    }
    if (decision.predictedImpact === "quality_up") {
      trace.evidenceSummary.evidenceScore = Math.min(100, trace.evidenceSummary.evidenceScore + 3);
    }
    if (decision.predictedImpact === "cost_up") {
      trace.costSummary.estimatedCostUsd = (trace.costSummary.estimatedCostUsd ?? 0.01) + 0.05;
    }
    if (decision.predictedImpact === "cost_down") {
      trace.costSummary.estimatedCostUsd = Math.max(0, (trace.costSummary.estimatedCostUsd ?? 0.01) * 0.8);
    }
  }
}

function decision(input: {
  phase: CounterfactualDecision["phase"];
  role?: string;
  actual: string;
  policy: string;
  impact: CounterfactualDecision["predictedImpact"];
  reason: string;
}): CounterfactualDecision {
  return {
    phase: input.phase,
    role: input.role,
    actualDecision: input.actual,
    policyDecision: input.policy,
    changed: input.actual !== input.policy,
    predictedImpact: input.impact,
    reason: input.reason
  };
}

function thresholdAtMost(actual: "low" | "medium" | "high", threshold: "medium" | "high"): boolean {
  const order = { low: 0, medium: 1, high: 2 };
  return order[actual] <= order[threshold];
}

function hasUnresolvedIssueSignal(trace: ObjectiveTraceV1): boolean {
  const haystack = [
    ...trace.evidenceSummary.missingEvidence,
    ...trace.verificationSummary.failedCriteria,
    ...trace.outcome.lessons,
    ...(trace.traceCompleteness?.missing ?? [])
  ].join("\n").toLowerCase();
  return /unresolved|blocking issue|critical|security|unsafe/.test(haystack);
}
