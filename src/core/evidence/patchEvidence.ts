import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import { buildEvidencePacket } from "./evidenceBuilder.js";
import type { EvidencePacket } from "./evidencePacket.js";

export function buildPatchEvidence(candidate: PatchCandidate, diffRef?: string): EvidencePacket {
  return buildEvidencePacket({
    phase: candidate.approach === "repair" ? "repair" : "patch",
    summary: `${candidate.candidateId}: ${candidate.summary}`,
    claims: [
      `Touches ${candidate.filesChanged.length} file(s): ${candidate.filesChanged.join(", ") || "none declared"}`,
      `Approach: ${candidate.approach}`,
      `Verification plan: ${candidate.testPlan.join("; ") || "not provided"}`
    ],
    supportingArtifacts: diffRef ? [diffRef] : [],
    riskSignals: [
      typeof candidate.estimatedRisk === "string" && candidate.estimatedRisk !== "low" ? `self-reported risk=${candidate.estimatedRisk}` : "",
      !candidate.unifiedDiff.trim() ? "candidate has no unified diff" : "",
      !candidate.testPlan.length ? "candidate has no verification plan" : ""
    ].filter(Boolean),
    verificationStatus: "unverified"
  });
}
