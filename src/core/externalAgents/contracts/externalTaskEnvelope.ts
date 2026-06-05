import type { AgentRole } from "../../../schemas/agentTask.js";
import type { Plan } from "../../../schemas/plan.js";
import type { ContextSelection } from "../../context/fileSelector.js";
import type { EvidencePacket } from "../../evidence/evidencePacket.js";
import type { PatchCandidate } from "../../../schemas/patchCandidate.js";
import type { ReviewReport } from "../../../schemas/review.js";
import type { JudgeDecision } from "../../../schemas/judge.js";

export type ExternalOutputContract = "plan" | "patch" | "review" | "judgment" | "freeform";

export type ExternalTaskEnvelope = {
  sessionId: string;
  role: AgentRole;
  goal: string;
  instructions: string;
  context: {
    plan?: Plan;
    contextSelection?: ContextSelection;
    evidencePackets?: EvidencePacket[];
    candidates?: PatchCandidate[];
    review?: ReviewReport;
    judge?: JudgeDecision;
  };
  outputContract: ExternalOutputContract;
};
