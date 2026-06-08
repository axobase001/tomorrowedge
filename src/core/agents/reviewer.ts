import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { RedTeamFinding, ReviewReport } from "../../schemas/review.js";
import type { EvidencePacket } from "../evidence/evidencePacket.js";
import { parseUnifiedDiff } from "../patch/patchParser.js";
import { BaseAgent } from "./baseAgent.js";

export class ReviewerAgent extends BaseAgent<{ candidates: PatchCandidate[]; evidencePackets?: EvidencePacket[]; redTeam?: boolean }, ReviewReport> {
  readonly role = "reviewer";

  async run(input: { candidates: PatchCandidate[]; evidencePackets?: EvidencePacket[]; redTeam?: boolean }): Promise<ReviewReport> {
    const reviews = input.candidates.map((candidate) => reviewCandidate(candidate, Boolean(input.redTeam), input.evidencePackets ?? []));
    return {
      mode: input.redTeam ? "red_team" : "standard",
      reviews,
      overallRecommendation: input.redTeam
        ? "Red-team review complete; judge should select only concrete diffs with visible verification evidence."
        : reviews.some((review) => review.recommendation === "accept" || review.recommendation === "accept_with_minor_change")
          ? "Review complete; judge may select only candidates without blocking concerns."
          : "Review complete; all candidates need revision before patch application."
    };
  }
}

function reviewCandidate(candidate: PatchCandidate, redTeam: boolean, evidencePackets: EvidencePacket[]): ReviewReport["reviews"][number] {
  const parsedTargets = parseTargets(candidate.unifiedDiff);
  const securityConcerns: string[] = [];
  const regressionConcerns: string[] = [];
  const redTeamFindings = redTeam ? buildRedTeamFindings(candidate) : [];

  if (!candidate.unifiedDiff.trim()) {
    regressionConcerns.push("No concrete diff produced in skeleton mode.");
  } else if (!parsedTargets.ok) {
    regressionConcerns.push(`Unified diff is not parseable: ${parsedTargets.error}`);
  } else if (!parsedTargets.targets.length) {
    regressionConcerns.push("Unified diff does not contain any file targets.");
  }

  if (parsedTargets.ok && parsedTargets.targets.length && candidate.filesChanged.length) {
    const declared = new Set(candidate.filesChanged);
    const missing = parsedTargets.targets.filter((target) => !declared.has(target));
    const extra = candidate.filesChanged.filter((target) => !parsedTargets.targets.includes(target));
    if (missing.length || extra.length) {
      regressionConcerns.push(`filesChanged does not match diff targets (missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}).`);
    }
  }

  if (!candidate.testPlan.length) {
    regressionConcerns.push("Candidate does not include a verification plan.");
  }
  if (candidate.filesChanged.length > 5) {
    regressionConcerns.push(`Candidate touches ${candidate.filesChanged.length} files and needs narrower scope or stronger evidence.`);
  }
  if (candidate.estimatedRisk === "high") {
    securityConcerns.push("Candidate self-reports high implementation risk.");
  }
  if (containsEncodingNoise(candidate.unifiedDiff)) {
    regressionConcerns.push("Diff appears to edit mojibake or binary-decoded text; context hygiene must be fixed before approval.");
  }

  const blockingConcerns = [...securityConcerns, ...regressionConcerns].filter((concern) => !concern.startsWith("Candidate touches "));
  const recommendation = chooseRecommendation(candidate, parsedTargets.ok ? parsedTargets.targets.length : 0, blockingConcerns);
  const correctnessScore = recommendation === "accept" ? 88 : recommendation === "accept_with_minor_change" ? 76 : recommendation === "revise" ? 52 : 20;
  const riskScore = candidate.estimatedRisk === "high" ? 80 : blockingConcerns.length ? 60 : candidate.estimatedRisk === "medium" ? 35 : 20;

  return {
    candidateId: candidate.candidateId,
    correctnessScore,
    riskScore,
    invasiveness: candidate.filesChanged.length > 5 ? "high" : candidate.filesChanged.length > 0 ? "medium" : "low",
    testCoverage: candidate.testPlan.length ? "adequate" : "none",
    securityConcerns,
    regressionConcerns,
    redTeamFindings,
    recommendation,
    notes: [
      "[MOCK] Offline reviewer used deterministic scoring.",
      `Evidence packets visible to reviewer: ${evidencePackets.length}.`,
      "Blocking concerns prevent automatic judge selection.",
      ...(redTeam ? ["Red-team pass checked missing diff, broad blast radius, and missing verification."] : [])
    ]
  };
}

function parseTargets(unifiedDiff: string): { ok: true; targets: string[] } | { ok: false; error: string } {
  if (!unifiedDiff.trim()) return { ok: true, targets: [] };
  try {
    const files = parseUnifiedDiff(unifiedDiff);
    return { ok: true, targets: files.map((file) => file.isDelete ? file.oldFileName : file.newFileName || file.oldFileName).filter(Boolean) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function chooseRecommendation(candidate: PatchCandidate, targetCount: number, blockingConcerns: string[]): "accept" | "accept_with_minor_change" | "revise" | "reject" {
  if (!candidate.unifiedDiff.trim() || targetCount === 0) return "reject";
  if (blockingConcerns.length) return blockingConcerns.some((concern) => /not parseable|mojibake|high implementation risk/i.test(concern)) ? "reject" : "revise";
  return candidate.estimatedRisk === "low" ? "accept" : "accept_with_minor_change";
}

function containsEncodingNoise(value: string): boolean {
  return /�|锟|鈥|乣|俓/.test(value);
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
      detail: "[MOCK] Red-team pass found no high-severity issue in this deterministic offline candidate.",
      requiresHumanAttention: false
    });
  }
  return findings;
}
