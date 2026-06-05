import type { RunResult } from "../../schemas/evidence.js";
import { buildEvidencePacket } from "./evidenceBuilder.js";
import type { EvidencePacket } from "./evidencePacket.js";

export function buildTestEvidence(result: RunResult, refs: { stdoutRef?: string; stderrRef?: string }): EvidencePacket {
  return buildEvidencePacket({
    phase: "test",
    summary: `${result.command} exited ${result.exitCode}`,
    claims: [
      `Command: ${result.command}`,
      `Duration: ${result.durationMs}ms`,
      result.success ? "Verification command passed." : "Verification command failed."
    ],
    supportingArtifacts: [refs.stdoutRef, refs.stderrRef].filter((ref): ref is string => Boolean(ref)),
    riskSignals: result.success ? [] : ["test command failed"],
    verificationStatus: result.success ? "passed" : "failed"
  });
}
