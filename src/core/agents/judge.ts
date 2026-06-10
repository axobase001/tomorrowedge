import type { JudgeDecision } from "../../schemas/judge.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { RiskLevel } from "../../schemas/plan.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { DebateRound } from "../../schemas/debate.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import type { DebateIssue, DebateSession } from "../debate/debateProtocol.js";
import { BaseAgent } from "./baseAgent.js";

export type JudgeAgentInput = {
  candidates: PatchCandidate[];
  review: ReviewReport;
  evidencePackets?: EvidencePacket[];
  debateRounds?: DebateRound[];
  debateSession?: DebateSession;
  allowPartialCompletion?: boolean;
  riskLevel?: RiskLevel;
};

export class JudgeAgent extends BaseAgent<JudgeAgentInput, JudgeDecision> {
  readonly role = "judge";

  async run(input: JudgeAgentInput): Promise<JudgeDecision> {
    const acceptable = input.review.reviews
      .filter((review) => (review.recommendation === "accept" || review.recommendation === "accept_with_minor_change") && !hasBlockingConcern(review))
      .sort((a, b) => b.correctnessScore - a.correctnessScore || a.riskScore - b.riskScore)[0];
    const debateBlock = blockingDebateDecision(input.debateSession, acceptable?.candidateId, input.allowPartialCompletion, input.riskLevel);
    if (debateBlock) return debateBlock;
    if (!acceptable) {
      const issueSummary = debateIssueSummary(input.debateSession, undefined);
      return {
        decision: input.review.reviews.some(hasCriticalConcern) ? "ask_user" : "request_revision",
        reason: `No candidate cleared reviewer blocking concerns for safe automatic application.${debateSuffix(input.debateRounds)}`,
        acceptedClaims: input.debateSession?.acceptedClaims,
        rejectedClaims: input.debateSession?.rejectedClaims,
        unresolvedBlockingIssues: issueSummary.blockingTitles,
        selectedCandidateBlockingIssues: issueSummary.selectedCandidateBlockingIssues,
        globalBlockingIssues: issueSummary.globalBlockingIssues,
        nonSelectedCandidateIssues: issueSummary.nonSelectedCandidateIssues,
        evidenceCoverageScore: input.debateSession?.evidenceCoverageScore,
        confidence: 0.62
      };
    }
    const criticalFinding = acceptable.redTeamFindings.find((finding) => finding.severity === "critical");
    if (criticalFinding) {
      const issueSummary = debateIssueSummary(input.debateSession, acceptable.candidateId);
      return {
        decision: "ask_user",
        reason: `Red-team review found a critical issue: ${criticalFinding.title}.`,
        acceptedClaims: input.debateSession?.acceptedClaims,
        rejectedClaims: input.debateSession?.rejectedClaims,
        unresolvedBlockingIssues: issueSummary.blockingTitles,
        selectedCandidateBlockingIssues: issueSummary.selectedCandidateBlockingIssues,
        globalBlockingIssues: issueSummary.globalBlockingIssues,
        nonSelectedCandidateIssues: issueSummary.nonSelectedCandidateIssues,
        evidenceCoverageScore: input.debateSession?.evidenceCoverageScore,
        confidence: 0.7,
        requiredUserDecision: "Approve, reject, or request a revised candidate after reviewing the critical red-team finding."
      };
    }
    const redTeamSuffix = input.review.mode === "red_team" ? " Red-team findings were included in the decision." : "";
    const evidenceSuffix = input.evidencePackets?.length ? ` Evidence packets considered=${input.evidencePackets.length}.` : "";
    const debateEvidence = debateSuffix(input.debateRounds?.filter((round) => round.targetCandidateId === acceptable.candidateId));
    const issueSummary = debateIssueSummary(input.debateSession, acceptable.candidateId);
    return {
      selectedCandidateId: acceptable.candidateId,
      decision: "select",
      reason: `Selected the highest scoring acceptable candidate.${redTeamSuffix}${evidenceSuffix}${debateEvidence}`,
      acceptedClaims: input.debateSession?.acceptedClaims,
      rejectedClaims: input.debateSession?.rejectedClaims,
      unresolvedBlockingIssues: issueSummary.blockingTitles,
      selectedCandidateBlockingIssues: issueSummary.selectedCandidateBlockingIssues,
      globalBlockingIssues: issueSummary.globalBlockingIssues,
      nonSelectedCandidateIssues: issueSummary.nonSelectedCandidateIssues,
      evidenceCoverageScore: input.debateSession?.evidenceCoverageScore,
      confidence: 0.78
    };
  }
}

function blockingDebateDecision(debateSession: DebateSession | undefined, selectedCandidateId: string | undefined, allowPartialCompletion = true, riskLevel: RiskLevel | undefined): JudgeDecision | undefined {
  const issueSummary = debateIssueSummary(debateSession, selectedCandidateId);
  const unresolvedIssues = [...issueSummary.globalBlockingIssues, ...issueSummary.selectedCandidateBlockingIssues];
  const unresolved = issueSummary.blockingTitles;
  if (!unresolved.length) return undefined;
  const hasGlobalBlockingIssue = issueSummary.globalBlockingIssues.length > 0;
  const mayProceedPartial = !hasGlobalBlockingIssue && allowPartialCompletion && riskLevel !== "high";
  if (mayProceedPartial) return undefined;
  return {
    decision: "request_revision",
    reason: `Debate Protocol v2 found unresolved blocking issue(s): ${unresolved.slice(0, 3).join("; ")}.`,
    acceptedClaims: debateSession?.acceptedClaims,
    rejectedClaims: debateSession?.rejectedClaims,
    unresolvedBlockingIssues: unresolved,
    unresolvedIssueIds: unresolvedIssues.map((issue) => issue.id),
    selectedCandidateBlockingIssues: issueSummary.selectedCandidateBlockingIssues,
    globalBlockingIssues: issueSummary.globalBlockingIssues,
    nonSelectedCandidateIssues: issueSummary.nonSelectedCandidateIssues,
    evidenceCoverageScore: debateSession?.evidenceCoverageScore,
    confidence: 0.72
  };
}

function debateIssueSummary(debateSession: DebateSession | undefined, selectedCandidateId: string | undefined): {
  selectedCandidateBlockingIssues: DebateIssue[];
  globalBlockingIssues: DebateIssue[];
  nonSelectedCandidateIssues: DebateIssue[];
  blockingTitles: string[];
} {
  const unresolved = debateSession?.unresolvedIssues ?? [];
  const globalBlockingIssues = unresolved.filter((issue) => issue.blocking && !issue.candidateId);
  const selectedCandidateBlockingIssues = selectedCandidateId
    ? unresolved.filter((issue) => issue.blocking && issue.candidateId === selectedCandidateId)
    : [];
  const nonSelectedCandidateIssues = unresolved.filter((issue) => issue.candidateId && issue.candidateId !== selectedCandidateId);
  return {
    selectedCandidateBlockingIssues,
    globalBlockingIssues,
    nonSelectedCandidateIssues,
    blockingTitles: [...globalBlockingIssues, ...selectedCandidateBlockingIssues].map((issue) => issue.title)
  };
}

function debateSuffix(rounds?: DebateRound[]): string {
  if (!rounds?.length) return "";
  const risks = rounds.map((round) => round.riskRaised).filter((risk): risk is string => Boolean(risk));
  const riskText = risks.length ? ` risks=${risks.slice(0, 2).join("; ")}` : " no blocking debate risk";
  return ` Debate rounds considered=${rounds.length};${riskText}.`;
}

function hasBlockingConcern(review: ReviewReport["reviews"][number]): boolean {
  return Boolean(review.securityConcerns.length || blockingRegressionConcerns(review).length || review.redTeamFindings.some((finding) => finding.severity === "high" || finding.severity === "critical"));
}

function hasCriticalConcern(review: ReviewReport["reviews"][number]): boolean {
  return review.redTeamFindings.some((finding) => finding.severity === "critical");
}

function blockingRegressionConcerns(review: ReviewReport["reviews"][number]): string[] {
  return review.regressionConcerns.filter((concern) => !concern.startsWith("Candidate touches "));
}
