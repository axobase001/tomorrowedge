import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { RedTeamFinding, ReviewReport } from "../../schemas/review.js";
import { BaseAgent } from "./baseAgent.js";

export class ReviewerAgent extends BaseAgent<{ candidates: PatchCandidate[]; redTeam?: boolean }, ReviewReport> {
  readonly role = "reviewer";

  async run(input: { candidates: PatchCandidate[]; redTeam?: boolean }): Promise<ReviewReport> {
    return {
      mode: input.redTeam ? "red_team" : "standard",
      reviews: input.candidates.map((candidate) => {
        const redTeamFindings = input.redTeam ? buildRedTeamFindings(candidate) : [];
        return {
          candidateId: candidate.candidateId,
          correctnessScore: candidate.unifiedDiff ? 70 : 40,
          riskScore: candidate.estimatedRisk === "high" ? 70 : 25,
          invasiveness: candidate.filesChanged.length > 5 ? "high" : candidate.filesChanged.length > 0 ? "medium" : "low",
          testCoverage: candidate.testPlan.length ? "adequate" : "none",
          securityConcerns: [],
          regressionConcerns: candidate.unifiedDiff ? [] : ["No concrete diff produced in skeleton mode."],
          redTeamFindings,
          recommendation: candidate.unifiedDiff ? "accept_with_minor_change" : "revise",
          notes: [
            "Offline reviewer used deterministic scoring.",
            ...(input.redTeam ? ["Red-team pass checked missing diff, broad blast radius, and missing verification."] : [])
          ]
        };
      }),
      overallRecommendation: input.redTeam
        ? "Red-team review complete; judge should select only concrete diffs with visible verification evidence."
        : "Review complete; judge should select only if a concrete diff exists."
    };
  }
}

function buildRedTeamFindings(candidate: PatchCandidate): RedTeamFinding[] {
  const findings: RedTeamFinding[] = [];
  if (!candidate.unifiedDiff) {
    findings.push({
      id: "no_concrete_diff",
      severity: "high",
      title: "No concrete patch",
      detail: "Candidate cannot be safely applied or tested because it contains no unified diff.",
      requiresHumanAttention: true
    });
  }
  if (candidate.filesChanged.length > 5) {
    findings.push({
      id: "wide_blast_radius",
      severity: "medium",
      title: "Wide blast radius",
      detail: `Candidate touches ${candidate.filesChanged.length} files; reviewer should verify scope before approval.`,
      requiresHumanAttention: true
    });
  }
  if (!candidate.testPlan.length) {
    findings.push({
      id: "missing_verification",
      severity: "medium",
      title: "Missing verification",
      detail: "Candidate does not propose a test or verification command.",
      requiresHumanAttention: true
    });
  }
  if (!findings.length) {
    findings.push({
      id: "bounded_fixture_change",
      severity: "low",
      title: "Bounded change",
      detail: "Red-team pass found no high-severity issue in this deterministic offline candidate.",
      requiresHumanAttention: false
    });
  }
  return findings;
}
