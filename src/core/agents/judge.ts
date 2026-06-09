import type { JudgeDecision } from "../../schemas/judge.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import { BaseAgent } from "./baseAgent.js";

export class JudgeAgent extends BaseAgent<{ candidates: PatchCandidate[]; review: ReviewReport; evidencePackets?: EvidencePacket[] }, JudgeDecision> {
  readonly role = "judge";

  async run(input: { candidates: PatchCandidate[]; review: ReviewReport; evidencePackets?: EvidencePacket[] }): Promise<JudgeDecision> {
    const acceptable = input.review.reviews
      .filter((review) => (review.recommendation === "accept" || review.recommendation === "accept_with_minor_change") && !hasBlockingConcern(review))
      .sort((a, b) => b.correctnessScore - a.correctnessScore || a.riskScore - b.riskScore)[0];
    if (!acceptable) {
      return {
        decision: input.review.reviews.some(hasCriticalConcern) ? "ask_user" : "request_revision",
        reason: "No candidate cleared reviewer blocking concerns for safe automatic application.",
        confidence: 0.62
      };
    }
    const criticalFinding = acceptable.redTeamFindings.find((finding) => finding.severity === "critical");
    if (criticalFinding) {
      return {
        decision: "ask_user",
        reason: `Red-team review found a critical issue: ${criticalFinding.title}.`,
        confidence: 0.7,
        requiredUserDecision: "Approve, reject, or request a revised candidate after reviewing the critical red-team finding."
      };
    }
    const redTeamSuffix = input.review.mode === "red_team" ? " Red-team findings were included in the decision." : "";
    const evidenceSuffix = input.evidencePackets?.length ? ` Evidence packets considered=${input.evidencePackets.length}.` : "";
    return {
      selectedCandidateId: acceptable.candidateId,
      decision: "select",
      reason: `Selected the highest scoring acceptable candidate.${redTeamSuffix}${evidenceSuffix}`,
      confidence: 0.78
    };
  }
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
// TODO: Add debateRounds to JudgeAgent.run() input
