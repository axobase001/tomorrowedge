import type { RunResult } from "../../schemas/evidence.js";
import { buildEvidencePacket } from "./evidenceBuilder.js";
import type { EvidencePacket } from "./evidencePacket.js";

export function buildTestEvidence(result: RunResult, refs: { stdoutRef?: string; stderrRef?: string }): EvidencePacket {
  const skipped = Boolean(result.skipped);
  return buildEvidencePacket({
    phase: "test",
    summary: skipped ? `${result.command} skipped` : `${result.command} exited ${result.exitCode}`,
    claims: [
      `Command: ${result.command}`,
      `Duration: ${result.durationMs}ms`,
      skipped ? `Verification command skipped: ${result.skipReason ?? "not applicable"}` : result.success ? "Verification command passed." : "Verification command failed."
    ],
    supportingArtifacts: [refs.stdoutRef, refs.stderrRef].filter((ref): ref is string => Boolean(ref)),
    riskSignals: skipped ? ["verification skipped"] : result.success ? [] : ["test command failed"],
    verificationStatus: skipped ? "partial" : result.success ? "passed" : "failed"
  });
}
