import type { DebateRound } from "../../schemas/debate.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import type { DebateClaim, DebateMove, DebateSession } from "./debateProtocol.js";

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
  const unresolvedBlockingIssues = claims.filter((claim) => claim.status === "unresolved" && claim.blocking).map((claim) => claim.claim);
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
    acceptedClaims,
    rejectedClaims,
    unresolvedBlockingIssues,
    evidenceCoverageScore,
    resolution: unresolvedBlockingIssues.length ? "request_revision" : "selectable"
  };
}

function evidenceCoverage(claims: DebateClaim[]): number {
  if (!claims.length) return 100;
  const covered = claims.filter((claim) => claim.evidenceRefs.length > 0).length;
  return Math.round((covered / claims.length) * 100);
}
