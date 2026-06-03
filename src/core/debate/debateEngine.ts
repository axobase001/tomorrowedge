import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { DebateRound } from "../../schemas/debate.js";
import { summarizeCandidate } from "./candidate.js";
import { chooseByScore } from "./judgeDecision.js";

export function summarizeDebate(candidates: PatchCandidate[], review?: ReviewReport): string[] {
  const lines = candidates.map(summarizeCandidate);
  if (review) {
    const decision = chooseByScore(review);
    lines.push(`judge-preview: ${decision.decision} (${decision.reason})`);
  }
  return lines;
}

export function buildDebateRounds(candidates: PatchCandidate[], review: ReviewReport | undefined, maxRounds: number): DebateRound[] {
  if (maxRounds <= 0) return [];
  const rounds: DebateRound[] = [];
  const limitedRounds = Math.min(maxRounds, 5);
  for (let round = 1; round <= limitedRounds; round++) {
    for (const candidate of candidates.slice(0, 4)) {
      const candidateReview = review?.reviews.find((item) => item.candidateId === candidate.candidateId);
      rounds.push({
        round,
        speaker: round % 2 === 1 ? "reviewer" : "opponent",
        targetCandidateId: candidate.candidateId,
        claim: buildClaim(candidate, candidateReview?.recommendation, round),
        evidence: [
          `${candidate.filesChanged.length} file(s) changed`,
          candidate.unifiedDiff ? "candidate has a concrete diff" : "candidate has no concrete diff",
          candidateReview ? `review recommendation: ${candidateReview.recommendation}` : "not reviewed yet"
        ],
        riskRaised: candidateReview?.regressionConcerns[0] ?? candidateReview?.securityConcerns[0]
      });
    }
  }
  return rounds;
}

function buildClaim(candidate: PatchCandidate, recommendation: string | undefined, round: number): string {
  if (!candidate.unifiedDiff) return "Candidate needs revision because no patch can be inspected or applied.";
  if (round === 1) return `Candidate argues for ${candidate.approach} with ${candidate.estimatedRisk} estimated risk.`;
  if (recommendation === "accept" || recommendation === "accept_with_minor_change") return "Opponent asks whether the test plan fully covers the changed behavior.";
  return "Candidate should narrow scope or provide stronger evidence before approval.";
}
