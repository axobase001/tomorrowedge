import type { ObjectiveContractV1 } from "./objectiveContract.js";
import { summarizeObjectiveContract } from "./objectiveContract.js";

export function renderObjectiveContractArtifact(contract: ObjectiveContractV1): string {
  return JSON.stringify({
    summary: summarizeObjectiveContract(contract),
    contract
  }, null, 2);
}

