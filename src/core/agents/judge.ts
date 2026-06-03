import type { JudgeDecision } from "../../schemas/judge.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../schemas/review.js";
import { BaseAgent } from "./baseAgent.js";

export class JudgeAgent extends BaseAgent<{ candidates: PatchCandidate[]; review: ReviewReport }, JudgeDecision> {
  readonly role = "judge";

  async run(input: { candidates: PatchCandidate[]; review: ReviewReport }): Promise<JudgeDecision> {
    const acceptable = input.review.reviews.find((review) => review.recommendation === "accept" || review.recommendation === "accept_with_minor_change");
    if (!acceptable) {
      return {
        decision: "request_revision",
        reason: "No candidate has enough evidence for safe application.",
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
    return {
      selectedCandidateId: acceptable.candidateId,
      decision: "select",
      reason: `Selected the highest scoring acceptable candidate.${redTeamSuffix}`,
      confidence: 0.78
    };
  }
}
