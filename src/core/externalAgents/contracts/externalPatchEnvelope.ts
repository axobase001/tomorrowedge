import type { PatchCandidate } from "../../../schemas/patchCandidate.js";
import type { ExternalResultEnvelope } from "./externalResultEnvelope.js";

export type ExternalPatchEnvelope = ExternalResultEnvelope & {
  payload: {
    candidate: PatchCandidate;
  };
};
