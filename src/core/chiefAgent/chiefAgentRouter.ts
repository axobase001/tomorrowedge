import type { TomorrowEdgeConfig } from "../../config/schema.js";
import { scoreAgentForRole } from "../agents/defaultCapabilityProfiles.js";
import type { AgentRuntimeProfile } from "../agents/capabilityProfile.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { ChiefAgentDecision, ChiefAgentProfile, ChiefAgentRunContext } from "./chiefAgentTypes.js";

export function selectChiefAgent(input: {
  config: TomorrowEdgeConfig;
  goal: string;
  availableAgents: AgentRuntimeProfile[];
  objectiveContract?: ObjectiveContractV1;
}): ChiefAgentProfile | undefined {
  const configured = input.config.chief_agent;
  if (configured?.id) {
    const profile = input.availableAgents.find((agent) => agent.agentId === configured.id || agent.provider === configured.provider);
    if (profile) {
      return {
        id: configured.id,
        provider: configured.provider || profile.provider,
        model: configured.model ?? profile.model,
        adapterId: configured.adapterId ?? profile.adapterId,
        roles: configured.roles,
        capabilities: profile.capabilities,
        trustLevel: configured.trustLevel,
        costTier: configured.costTier,
        fallbackAgentId: configured.fallbackAgentId
      };
    }
    return undefined;
  }

  const risk = input.objectiveContract?.riskLevel ?? inferRisk(input.goal);
  const candidates = input.availableAgents
    .filter((agent) => agent.allowedRoles.includes("core") || agent.allowedRoles.includes("planner") || agent.allowedRoles.includes("judge"))
    .map((agent) => ({ agent, score: scoreAgentForRole(agent, "chief", risk) }))
    .sort((a, b) => b.score - a.score);
  const selected = candidates[0]?.agent;
  if (!selected) return undefined;
  return {
    id: selected.agentId,
    provider: selected.provider,
    model: selected.model,
    adapterId: selected.adapterId,
    roles: ["lead_planner", "architecture_reviewer", "final_judge", "final_code_review"],
    capabilities: selected.capabilities,
    trustLevel: selected.trustLevel,
    costTier: selected.capabilities.costTier
  };
}

export async function routeToChiefAgent(input: {
  chiefAgent: ChiefAgentProfile;
  goal: string;
  context: ChiefAgentRunContext;
}): Promise<ChiefAgentDecision> {
  const risk = input.context.objectiveContract?.riskLevel ?? inferRisk(input.goal);
  const workflowKind = input.context.objectiveContract?.workflowKind;
  if (workflowKind === "read_only" && risk === "low") {
    return {
      chiefAgentId: input.chiefAgent.id,
      action: "plan_directly",
      reason: "Read-only low-risk task can be handled by chief planning without convening a council.",
      initialRiskAssessment: "low"
    };
  }
  if (requiresCouncil(input.goal, risk)) {
    return {
      chiefAgentId: input.chiefAgent.id,
      action: "convene_council",
      reason: "High-level rewrite, migration, refactor, or high-risk engineering task requires structured council planning.",
      requiredCouncilRoles: ["architect", "implementer", "risk_checker", "test_planner"],
      initialRiskAssessment: risk
    };
  }
  return {
    chiefAgentId: input.chiefAgent.id,
    action: "delegate_simple",
    reason: "Task can be delegated after chief produces a compact plan.",
    requiredCouncilRoles: ["implementer", "reviewer"],
    initialRiskAssessment: risk
  };
}

export function inferRisk(goal: string): "low" | "medium" | "high" {
  const lower = goal.toLowerCase();
  if (/auth|security|payment|database|migration|rewrite|rebuild|rust|infra|permission|secret/.test(lower)) return "high";
  if (/refactor|feature|repair|failing|bug|test|api/.test(lower)) return "medium";
  return "low";
}

function requiresCouncil(goal: string, risk: "low" | "medium" | "high"): boolean {
  if (risk === "high") return true;
  return /rewrite|rebuild|migration|migrate|redesign|architecture|large|multi[- ]?module|rust|tauri|full app/i.test(goal);
}
