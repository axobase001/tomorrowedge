import type { DebateRound } from "../../schemas/debate.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import type { DebateClaim, DebateIssue, DebateMove, DebateSession } from "./debateProtocol.js";

export function buildDebateSession(input: {
  sessionId: string;
  candidates: PatchCandidate[];
  review?: ReviewReport;
  debateRounds: DebateRound[];
  evidencePackets: EvidencePacket[];
  maxRounds: number;
}): DebateSession {
  const packetRefs = input.evidencePackets.flatMap((packet) => packet.supportingArtifacts);
  const candidateClaims = input.candidates.map<DebateClaim>((candidate) => ({
    id: `claim_${candidate.candidateId}`,
    speaker: candidate.agentId,
    targetCandidateId: candidate.candidateId,
    claim: candidate.summary,
    evidenceRefs: candidate.unifiedDiff ? ["candidate_diff", ...packetRefs] : packetRefs,
    status: "accepted",
    blocking: false
  }));
  const reviewClaims = (input.review?.reviews ?? []).flatMap<DebateClaim>((review) => {
    const blocking = Boolean(review.securityConcerns.length || review.regressionConcerns.length || review.redTeamFindings.some((finding) => finding.severity === "high" || finding.severity === "critical"));
    return [
      ...review.securityConcerns,
      ...review.regressionConcerns,
      ...review.redTeamFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical").map((finding) => finding.title)
    ].map((claim, index) => ({
      id: `claim_${review.candidateId}_risk_${index + 1}`,
      speaker: "reviewer",
      targetCandidateId: review.candidateId,
      claim,
      evidenceRefs: packetRefs,
      status: blocking ? "unresolved" : "accepted",
      blocking
    }));
  });
  const roundMoves = input.debateRounds.map<DebateMove>((round, index) => ({
    id: `move_${round.round}_${index + 1}`,
    round: round.round,
    speaker: round.speaker,
    moveType: round.riskRaised ? "challenge" : "claim",
    targetCandidateId: round.targetCandidateId,
    content: round.claim,
    evidenceRefs: round.evidence,
    riskSignal: round.riskRaised
  }));
  const claims = [...candidateClaims, ...reviewClaims];
  const issues = buildIssues(input.review, roundMoves, packetRefs);
  const unresolvedIssues = issues.filter((issue) => issue.status === "open");
  const unresolvedBlockingIssues = unresolvedIssues.filter((issue) => issue.blocking).map((issue) => issue.title);
  const acceptedClaims = claims.filter((claim) => claim.status === "accepted").map((claim) => claim.claim);
  const rejectedClaims = claims.filter((claim) => claim.status === "rejected").map((claim) => claim.claim);
  const evidenceCoverageScore = evidenceCoverage(claims);
  return {
    sessionId: input.sessionId,
    maxRounds: input.maxRounds,
    moves: [
      ...roundMoves,
      {
        id: "move_resolution",
        round: Math.max(1, ...roundMoves.map((move) => move.round), 1),
        speaker: "judge",
        moveType: "resolution",
        content: unresolvedBlockingIssues.length
          ? `Revision required: ${unresolvedBlockingIssues.slice(0, 3).join("; ")}`
          : "No unresolved blocking issue found in structured debate.",
        evidenceRefs: packetRefs
      }
    ],
    claims,
    issues,
    unresolvedIssues,
    acceptedClaims,
    rejectedClaims,
    unresolvedBlockingIssues,
    evidenceCoverageScore,
    resolution: unresolvedBlockingIssues.length ? "request_revision" : "selectable"
  };
}

function buildIssues(review: ReviewReport | undefined, moves: DebateMove[], packetRefs: string[]): DebateIssue[] {
  const issues: DebateIssue[] = [];
  for (const item of review?.reviews ?? []) {
    const security = item.securityConcerns.map((title) => ({ title, global: true, evidence: ["security review evidence"] }));
    const regressions = item.regressionConcerns.map((title) => ({ title, global: false, evidence: ["regression evidence"] }));
    const redTeam = item.redTeamFindings
      .filter((finding) => finding.severity === "high" || finding.severity === "critical")
      .map((finding) => ({ title: finding.title, global: finding.severity === "critical", evidence: ["red-team evidence"] }));
    for (const [index, risk] of [...security, ...regressions, ...redTeam].entries()) {
      const relatedMoveIds = moves
        .filter((move) => move.targetCandidateId === item.candidateId || risk.global && !move.targetCandidateId)
        .map((move) => move.id);
      issues.push({
        id: `issue_${item.candidateId}_${index + 1}`,
        candidateId: risk.global ? undefined : item.candidateId,
        title: risk.title,
        blocking: true,
        status: "open",
        requiredEvidence: packetRefs.length ? packetRefs : risk.evidence,
        relatedMoveIds
      });
    }
    if (item.testCoverage === "weak" && item.recommendation !== "accept") {
      issues.push({
        id: `issue_${item.candidateId}_test_coverage`,
        candidateId: item.candidateId,
        title: "Candidate lacks enough test evidence for automatic selection.",
        blocking: item.riskScore >= 70,
        status: "open",
        requiredEvidence: ["test evidence"],
        relatedMoveIds: moves.filter((move) => move.targetCandidateId === item.candidateId).map((move) => move.id)
      });
    }
  }
  return issues;
}

function evidenceCoverage(claims: DebateClaim[]): number {
  if (!claims.length) return 100;
  const covered = claims.filter((claim) => claim.evidenceRefs.length > 0).length;
  return Math.round((covered / claims.length) * 100);
}
