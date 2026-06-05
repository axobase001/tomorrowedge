import { makeId } from "../../utils/ids.js";
import type { EvidencePacket, EvidencePhase } from "./evidencePacket.js";

export function buildEvidencePacket(input: {
  phase: EvidencePhase;
  summary: string;
  claims?: string[];
  supportingArtifacts?: string[];
  riskSignals?: string[];
  verificationStatus?: EvidencePacket["verificationStatus"];
}): EvidencePacket {
  const packet: EvidencePacket = {
    id: makeId("evidence"),
    phase: input.phase,
    summary: input.summary,
    claims: input.claims ?? [],
    supportingArtifacts: input.supportingArtifacts ?? [],
    riskSignals: input.riskSignals ?? [],
    verificationStatus: input.verificationStatus ?? "unverified",
    modelVisibleText: ""
  };
  packet.modelVisibleText = renderEvidencePacket(packet);
  return packet;
}

export function renderEvidencePacket(packet: EvidencePacket): string {
  return [
    `Evidence Packet: ${packet.phase}`,
    `Status: ${packet.verificationStatus}`,
    `Summary: ${packet.summary}`,
    packet.claims.length ? `Claims:\n${packet.claims.map((claim) => `- ${claim}`).join("\n")}` : "",
    packet.riskSignals.length ? `Risk Signals:\n${packet.riskSignals.map((risk) => `- ${risk}`).join("\n")}` : "",
    packet.supportingArtifacts.length ? `Artifacts: ${packet.supportingArtifacts.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}
