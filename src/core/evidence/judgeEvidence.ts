import type { JudgeDecision } from "../../schemas/judge.js";
import { buildEvidencePacket } from "./evidenceBuilder.js";
import type { EvidencePacket } from "./evidencePacket.js";

export function buildJudgeEvidence(judge: JudgeDecision, decisionRef?: string): EvidencePacket {
  return buildEvidencePacket({
    phase: "judge",
    summary: `${judge.decision}: ${judge.reason}`,
    claims: [
      judge.selectedCandidateId ? `Selected candidate: ${judge.selectedCandidateId}` : "No candidate selected.",
      `Confidence: ${judge.confidence}`
    ],
    supportingArtifacts: decisionRef ? [decisionRef] : [],
    riskSignals: judge.decision === "select" ? [] : [judge.reason],
    verificationStatus: judge.decision === "select" ? "partial" : "unverified"
  });
}
