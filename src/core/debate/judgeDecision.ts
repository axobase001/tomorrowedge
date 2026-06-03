import type { JudgeDecision } from "../../schemas/judge.js";
import type { ReviewReport } from "../../schemas/review.js";
import { scoreReview } from "./scoring.js";

export function chooseByScore(review: ReviewReport): JudgeDecision {
  const ranked = [...review.reviews].sort((a, b) => scoreReview(b) - scoreReview(a));
  const best = ranked[0];
  if (!best || best.recommendation === "reject") {
    return {
      decision: "request_revision",
      reason: "No candidate passed review scoring.",
      confidence: 0.5
    };
  }
  return {
    decision: best.recommendation === "revise" ? "request_revision" : "select",
    selectedCandidateId: best.recommendation === "revise" ? undefined : best.candidateId,
    reason: `Best score from reviewer: ${scoreReview(best)}.`,
    confidence: Math.min(0.95, Math.max(0.1, scoreReview(best) / 100))
  };
}
