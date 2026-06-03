import type { ContextSelection } from "../context/fileSelector.js";
import type { AgentRunState } from "../../schemas/agentTask.js";
import type { FinalSummary, RunResult } from "../../schemas/evidence.js";
import type { DebateRound } from "../../schemas/debate.js";
import type { JudgeDecision } from "../../schemas/judge.js";
import type { ModelBudgetStatus, ModelNote, ModelUsageSummary } from "../../schemas/modelNote.js";
import type { PatchCandidate } from "../../schemas/patchCandidate.js";
import type { Plan } from "../../schemas/plan.js";
import type { ReviewReport } from "../../schemas/review.js";
import type { RoutingPlan } from "../routing/policies.js";
import type { AccessPolicy } from "../permissions/accessPolicy.js";

export type AgentGraphState = {
  goal: string;
  routing: RoutingPlan;
  access: AccessPolicy;
  agents: AgentRunState[];
  plan?: Plan;
  contextSelection?: ContextSelection;
  candidates: PatchCandidate[];
  repairCandidates: PatchCandidate[];
  debateRounds: DebateRound[];
  modelNotes: ModelNote[];
  usageSummary: ModelUsageSummary;
  budgetStatus?: ModelBudgetStatus;
  review?: ReviewReport;
  judge?: JudgeDecision;
  changedFiles: string[];
  runResults: RunResult[];
  approvals: {
    patchApproved: boolean;
    shellApproved: boolean;
    repairApproved: boolean;
  };
  finalSummary?: FinalSummary;
};
