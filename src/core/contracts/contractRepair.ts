import type { ContractVerificationInput, ContractVerificationOutput } from "./contractVerifier.js";
import { verifyAndRepairContract } from "./contractVerifier.js";
import type { ObjectiveContractV1 } from "./objectiveContract.js";

export function repairObjectiveContract(contract: ObjectiveContractV1, input: ContractVerificationInput): ContractVerificationOutput {
  return verifyAndRepairContract(contract, input);
}

