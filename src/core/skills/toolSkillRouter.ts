import type { AccessMode } from "../../config/schema.js";
import type { ObjectiveContractV1 } from "../contracts/objectiveContract.js";
import type { OrchestrationPolicyGenome } from "../orchestrationPolicy/orchestrationPolicy.js";
import type { ScenarioProfile } from "../scenarios/scenarioTypes.js";
import type { SkillManifestV1 } from "./skillTypes.js";
import { SkillRegistry } from "./skillRegistry.js";

export type ToolSkillRoutingPreference = "safe" | "trace_score" | "minimal_permissions";

export type ToolSkillRouteDecision = {
  skillId: string;
  version: string;
  selected: boolean;
  reason: string;
  status: "selected" | "skipped" | "blocked";
  lifecycle: SkillManifestV1["lifecycle"];
  riskLevel: SkillManifestV1["riskLevel"];
  requiredTools: string[];
  permissionIntents: string[];
  score: number;
};

export type ToolSkillRoutingInput = {
  registry: SkillRegistry;
  contract: ObjectiveContractV1;
  scenarioProfile: ScenarioProfile;
  accessMode: AccessMode;
  policy?: OrchestrationPolicyGenome;
  traceScores?: Record<string, number>;
  limit?: number;
};

export function routeToolsAndSkills(input: ToolSkillRoutingInput): ToolSkillRouteDecision[] {
  const preference = input.policy?.toolRoutingPolicy?.preference ?? "safe";
  const allowCandidates = input.policy?.toolRoutingPolicy?.allowCandidateSkills ?? false;
  const requireValidation = input.policy?.toolRoutingPolicy?.requireValidation !== false;
  const candidates = input.registry.listSkills({
    scenarioType: input.scenarioProfile.scenarioType,
    accessMode: input.accessMode,
    maxRisk: input.contract.riskLevel
  });
  const decisions = candidates.map((skill) => decisionFor(skill, input, preference, allowCandidates, requireValidation));
  const selected = decisions
    .filter((decision) => decision.status !== "blocked")
    .sort((a, b) => b.score - a.score || a.permissionIntents.length - b.permissionIntents.length)
    .slice(0, input.limit ?? 8)
    .map((decision) => ({ ...decision, selected: true, status: "selected" as const, reason: `selected by ${preference}: ${decision.reason}` }));
  const selectedKeys = new Set(selected.map((decision) => `${decision.skillId}@${decision.version}`));
  return [
    ...selected,
    ...decisions
      .filter((decision) => !selectedKeys.has(`${decision.skillId}@${decision.version}`))
      .map((decision) => decision.status === "blocked" ? decision : { ...decision, status: "skipped" as const, selected: false })
  ];
}

function decisionFor(
  skill: SkillManifestV1,
  input: ToolSkillRoutingInput,
  preference: ToolSkillRoutingPreference,
  allowCandidates: boolean,
  requireValidation: boolean
): ToolSkillRouteDecision {
  const blocked = blockedReason(skill, input, allowCandidates, requireValidation);
  const traceScore = input.traceScores?.[skill.skillId] ?? 0;
  const baseScore = preference === "trace_score" ? traceScore : preference === "minimal_permissions" ? 20 - skill.permissions.intents.length * 2 : safetyScore(skill);
  const scenarioBoost = skill.scenarios.includes(input.scenarioProfile.scenarioType) ? 10 : 0;
  const toolBoost = skill.requiredTools.some((tool) => input.contract.allowedTools.includes(tool) || input.contract.allowedTools.includes(skill.skillId)) ? 8 : 0;
  return {
    skillId: skill.skillId,
    version: skill.version,
    selected: false,
    reason: blocked ?? `score=${baseScore + scenarioBoost + toolBoost}`,
    status: blocked ? "blocked" : "skipped",
    lifecycle: skill.lifecycle,
    riskLevel: skill.riskLevel,
    requiredTools: [...skill.requiredTools],
    permissionIntents: [...skill.permissions.intents],
    score: blocked ? -100 : baseScore + scenarioBoost + toolBoost
  };
}

function blockedReason(skill: SkillManifestV1, input: ToolSkillRoutingInput, allowCandidates: boolean, requireValidation: boolean): string | undefined {
  if (!skill.allowedAccessModes.includes(input.accessMode)) return `access mode ${input.accessMode} not allowed`;
  if (skill.lifecycle === "candidate" && !allowCandidates) return "candidate skills are disabled by policy";
  if (requireValidation && !["stable", "validated"].includes(skill.lifecycle)) return `lifecycle ${skill.lifecycle} is not validated`;
  if (["blocked", "rejected", "deprecated", "rolled_back"].includes(skill.lifecycle)) return `lifecycle ${skill.lifecycle} is not routeable`;
  const allowedTools = new Set(input.contract.allowedTools);
  const missing = skill.requiredTools.filter((tool) => !allowedTools.has(tool) && !allowedTools.has(skill.skillId) && !allowedTools.has(tool.split(".")[0] ?? tool));
  if (missing.length) return `contract does not allow ${missing.join(", ")}`;
  if (input.accessMode === "restricted" && (skill.permissions.filesystem.write || skill.permissions.shell.allowed || skill.permissions.network.allowed || skill.permissions.intents.includes("database") || skill.permissions.github.write)) {
    return "restricted mode blocks write/shell/network/database/github-write permissions";
  }
  return undefined;
}

function safetyScore(skill: SkillManifestV1): number {
  let score = 30;
  if (skill.riskLevel === "medium") score -= 6;
  if (skill.riskLevel === "high") score -= 14;
  if (skill.permissions.shell.allowed) score -= 5;
  if (skill.permissions.network.allowed) score -= 4;
  if (skill.permissions.intents.includes("database")) score -= 6;
  if (skill.permissions.filesystem.write) score -= 5;
  if (skill.permissions.github.write) score -= 6;
  if (skill.lifecycle === "stable") score += 8;
  if (skill.lifecycle === "validated") score += 4;
  return score;
}
