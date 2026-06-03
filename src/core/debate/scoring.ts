import type { CandidateReview } from "../../schemas/review.js";

export function scoreReview(review: CandidateReview): number {
  const recommendationBonus = {
    accept: 30,
    accept_with_minor_change: 15,
    revise: -10,
    reject: -40
  }[review.recommendation];
  return review.correctnessScore - review.riskScore + recommendationBonus;
}
