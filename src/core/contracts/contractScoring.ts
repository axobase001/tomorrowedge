import type { ContractVerificationResult, ObjectiveContractV1 } from "./objectiveContract.js";

export function scoreContractQuality(contract: ObjectiveContractV1, verification?: ContractVerificationResult): number {
  const base = verification?.score ?? 80;
  const evidenceBonus = Math.min(10, contract.requiredEvidence.length);
  const criteriaBonus = Math.min(8, contract.successCriteria.length * 2);
  const ambiguityPenalty = contract.userScenario.ambiguityLevel === "high" ? 12 : contract.userScenario.ambiguityLevel === "medium" ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(base + evidenceBonus + criteriaBonus - ambiguityPenalty)));
}

