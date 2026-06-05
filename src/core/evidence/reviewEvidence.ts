import type { ReviewReport } from "../../schemas/review.js";
import { buildEvidencePacket } from "./evidenceBuilder.js";
import type { EvidencePacket } from "./evidencePacket.js";

export function buildReviewEvidence(review: ReviewReport, reviewRef?: string): EvidencePacket {
  const blocking = review.reviews.flatMap((item) => [...item.securityConcerns, ...item.regressionConcerns]);
  return buildEvidencePacket({
    phase: "review",
    summary: review.overallRecommendation,
    claims: review.reviews.map((item) => `${item.candidateId}: ${item.recommendation}, correctness=${item.correctnessScore}, risk=${item.riskScore}`),
    supportingArtifacts: reviewRef ? [reviewRef] : [],
    riskSignals: blocking,
    verificationStatus: review.reviews.some((item) => item.recommendation === "accept" || item.recommendation === "accept_with_minor_change") ? "partial" : "unverified"
  });
}
