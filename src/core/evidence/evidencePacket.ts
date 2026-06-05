export type EvidencePhase = "plan" | "patch" | "test" | "repair" | "review" | "judge";

export type EvidencePacket = {
  id: string;
  phase: EvidencePhase;
  summary: string;
  claims: string[];
  supportingArtifacts: string[];
  riskSignals: string[];
  verificationStatus: "unverified" | "passed" | "failed" | "partial";
  modelVisibleText: string;
};
