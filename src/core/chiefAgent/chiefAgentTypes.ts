import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { AgentCapabilityProfile, AgentRuntimeProfile, AgentTrustLevel } from "../agents/capabilityProfile.js";

export type ChiefAgentRole =
  | "lead_planner"
  | "architecture_reviewer"
  | "final_judge"
  | "final_code_review";

export type ChiefAgentProfile = {
  id: string;
  provider: string;
  model?: string;
  adapterId?: string;
  roles: ChiefAgentRole[];
  capabilities: AgentCapabilityProfile;
  trustLevel: AgentTrustLevel;
  costTier: "cheap" | "medium" | "expensive";
  fallbackAgentId?: string;
};

export type ChiefAgentDecision = {
  chiefAgentId: string;
  action:
    | "plan_directly"
    | "convene_council"
    | "delegate_simple"
    | "ask_user"
    | "abort";
  reason: string;
  requiredCouncilRoles?: string[];
  initialRiskAssessment: "low" | "medium" | "high";
};

export type ChiefAgentRunContext = {
  cwd: string;
  config: TomorrowEdgeConfig;
  objectiveContract?: ObjectiveContractV1;
  availableAgents: AgentRuntimeProfile[];
};
