import type { PatchCandidate } from "../../schemas/patchCandidate.js";

export function summarizeCandidate(candidate: PatchCandidate): string {
  const files = candidate.filesChanged.length ? candidate.filesChanged.join(", ") : "no files";
  return `${candidate.candidateId}: ${candidate.approach}, ${candidate.estimatedRisk} risk, ${files}`;
}
