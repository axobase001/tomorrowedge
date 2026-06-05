import type { JudgeDecision } from "../../../schemas/judge.js";
import type { ExternalResultEnvelope } from "./externalResultEnvelope.js";

export type ExternalJudgeEnvelope = ExternalResultEnvelope & {
  payload: {
    judgment: JudgeDecision;
  };
};
