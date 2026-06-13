import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";
import { agentRoles } from "../../schemas/agentTask.js";
import { capabilityProfileFromTags, configuredCapabilityOverride, mergeCapabilityProfile, type AgentCapabilityProfile, type AgentRuntimeProfile, type AgentTrustLevel } from "./capabilityProfile.js";

const allRoles = [...agentRoles];

export const baselineCapabilityProfile: AgentCapabilityProfile = {
  planning: 0.45,
  architecture: 0.4,
  coding: 0.45,
  review: 0.35,
  judging: 0.3,
  repair: 0.35,
  longContext: 0.35,
  toolUse: 0.35,
  patchGeneration: 0.35,
  testGeneration: 0.35,
  costTier: "medium",
  latencyTier: "medium",
  reliabilityScore: 0.55,
  supportsMcp: false,
  supportsJson: true,
  supportsPatch: true,
  supportsShell: false
};

export const defaultAgentCapabilityProfiles: Record<string, AgentCapabilityProfile> = {
  codex_mcp: {
    planning: 0.95,
    architecture: 0.95,
    coding: 0.9,
    review: 0.92,
    judging: 0.95,
    repair: 0.85,
    longContext: 0.85,
    toolUse: 0.95,
    patchGeneration: 0.9,
    testGeneration: 0.8,
    costTier: "expensive",
    latencyTier: "medium",
    reliabilityScore: 0.9,
    supportsMcp: true,
    supportsJson: true,
    supportsPatch: true,
    supportsShell: true
  },
  claude_code: {
    planning: 0.92,
    architecture: 0.94,
    coding: 0.86,
    review: 0.94,
    judging: 0.9,
    repair: 0.82,
    longContext: 0.88,
    toolUse: 0.9,
    patchGeneration: 0.85,
    testGeneration: 0.78,
    costTier: "expensive",
    latencyTier: "medium",
    reliabilityScore: 0.88,
    supportsMcp: true,
    supportsJson: true,
    supportsPatch: true,
    supportsShell: true
  },
  deepseek: {
    planning: 0.72,
    architecture: 0.7,
    coding: 0.86,
    review: 0.74,
    judging: 0.66,
    repair: 0.78,
    longContext: 0.72,
    toolUse: 0.62,
    patchGeneration: 0.84,
    testGeneration: 0.66,
    costTier: "medium",
    latencyTier: "fast",
    reliabilityScore: 0.78,
    supportsMcp: false,
    supportsJson: true,
    supportsPatch: true,
    supportsShell: false
  },
  mimo: {
    planning: 0.56,
    architecture: 0.52,
    coding: 0.68,
    review: 0.58,
    judging: 0.48,
    repair: 0.6,
    longContext: 0.62,
    toolUse: 0.45,
    patchGeneration: 0.62,
    testGeneration: 0.7,
    costTier: "cheap",
    latencyTier: "fast",
    reliabilityScore: 0.67,
    supportsMcp: false,
    supportsJson: true,
    supportsPatch: true,
    supportsShell: false
  },
  mock: {
    ...baselineCapabilityProfile,
    planning: 0.7,
    architecture: 0.65,
    coding: 0.7,
    review: 0.65,
    judging: 0.62,
    costTier: "cheap",
    latencyTier: "fast",
    reliabilityScore: 0.8
  },
  fixture: {
    ...baselineCapabilityProfile,
    planning: 0.75,
    architecture: 0.7,
    coding: 0.75,
    review: 0.7,
    judging: 0.7,
    costTier: "cheap",
    latencyTier: "fast",
    reliabilityScore: 0.88
  },
  ollama: {
    ...baselineCapabilityProfile,
    costTier: "cheap",
    latencyTier: "medium",
    reliabilityScore: 0.6,
    supportsShell: false
  }
};

export function buildAgentRuntimeProfiles(config: TomorrowEdgeConfig): AgentRuntimeProfile[] {
  const profiles: AgentRuntimeProfile[] = [];

  for (const [provider, providerConfig] of Object.entries(config.providers)) {
    if (!providerConfig.enabled) continue;
    const base = defaultProfileFor(provider);
    const override = configuredCapabilityOverride(config, provider);
    profiles.push({
      agentId: provider,
      provider,
      model: providerConfig.model || providerConfig.models[0]?.id || "configured-model",
      capabilities: mergeCapabilityProfile(base, override),
      allowedRoles: override?.allowedRoles ?? defaultRolesForProvider(provider),
      maxParallelTasks: override?.maxParallelTasks,
      trustLevel: override?.trustLevel ?? defaultTrustForProvider(provider)
    });
  }

  for (const [agentId, external] of Object.entries(config.external_agents ?? {})) {
    if (!external.enabled) continue;
    const provider = external.adapter === "claude_code" ? "claude_code" : external.adapter === "codex" ? "codex_mcp" : agentId;
    const base = capabilityProfileFromTags(external.capabilities, defaultProfileFor(provider));
    const override = configuredCapabilityOverride(config, agentId);
    profiles.push({
      agentId,
      provider: `external:${agentId}`,
      model: external.name ?? agentId,
      adapterId: external.adapter,
      capabilities: mergeCapabilityProfile(base, override),
      allowedRoles: override?.allowedRoles ?? (external.roles.length ? external.roles : allRoles),
      maxParallelTasks: override?.maxParallelTasks,
      trustLevel: normalizeTrust(external.trustLevel, override?.trustLevel)
    });
  }

  return dedupeProfiles(profiles.length ? profiles : [{
    agentId: "mock-chief",
    provider: "mock",
    model: "mock-balanced",
    capabilities: defaultAgentCapabilityProfiles.mock,
    allowedRoles: allRoles,
    trustLevel: "medium"
  }]);
}

export function defaultProfileFor(providerOrAgentId: string): AgentCapabilityProfile {
  const normalized = providerOrAgentId.toLowerCase();
  if (normalized.includes("codex")) return defaultAgentCapabilityProfiles.codex_mcp;
  if (normalized.includes("claude") || normalized.includes("anthropic")) return defaultAgentCapabilityProfiles.claude_code;
  if (normalized.includes("deepseek")) return defaultAgentCapabilityProfiles.deepseek;
  if (normalized.includes("mimo")) return defaultAgentCapabilityProfiles.mimo;
  if (normalized.includes("fixture")) return defaultAgentCapabilityProfiles.fixture;
  if (normalized.includes("ollama") || normalized.includes("local")) return defaultAgentCapabilityProfiles.ollama;
  if (normalized.includes("mock")) return defaultAgentCapabilityProfiles.mock;
  return baselineCapabilityProfile;
}

export function scoreAgentForRole(profile: AgentRuntimeProfile, role: AgentRole | "chief" | "final_review" | "test_planner", risk: "low" | "medium" | "high" = "medium"): number {
  const caps = profile.capabilities;
  const costPenalty = caps.costTier === "expensive" ? 0.12 : caps.costTier === "medium" ? 0.04 : 0;
  const reliabilityBoost = caps.reliabilityScore * 0.2;
  const riskDecisionBoost = risk === "high" ? (caps.review + caps.judging + caps.architecture) * 0.12 : 0;
  const roleScore = (() => {
    switch (role) {
      case "core":
      case "planner":
      case "chief":
        return caps.planning * 0.4 + caps.architecture * 0.3 + caps.judging * 0.2 + caps.toolUse * 0.1;
      case "reviewer":
      case "final_review":
        return caps.review * 0.45 + caps.architecture * 0.25 + caps.judging * 0.2 + caps.reliabilityScore * 0.1;
      case "judge":
        return caps.judging * 0.5 + caps.review * 0.25 + caps.architecture * 0.15 + caps.reliabilityScore * 0.1;
      case "coder_a":
      case "coder_b":
      case "repairer":
        return caps.coding * 0.38 + caps.patchGeneration * 0.3 + caps.repair * 0.17 + caps.longContext * 0.15;
      case "runner":
      case "test_planner":
        return caps.testGeneration * 0.38 + caps.toolUse * 0.22 + caps.coding * 0.18 + caps.reliabilityScore * 0.22;
      case "explorer":
        return caps.longContext * 0.4 + caps.planning * 0.25 + caps.toolUse * 0.2 + caps.reliabilityScore * 0.15;
      case "summarizer":
        return caps.review * 0.25 + caps.planning * 0.25 + caps.longContext * 0.25 + caps.reliabilityScore * 0.25;
      case "vision":
        return caps.longContext * 0.25 + caps.planning * 0.25 + caps.toolUse * 0.25 + caps.reliabilityScore * 0.25;
    }
  })();
  return Math.max(0, roleScore + reliabilityBoost + riskDecisionBoost - costPenalty);
}

function defaultRolesForProvider(provider: string): AgentRole[] {
  if (/deepseek/i.test(provider)) return ["planner", "explorer", "coder_a", "coder_b", "reviewer", "repairer"];
  if (/mimo/i.test(provider)) return ["explorer", "coder_b", "reviewer", "runner", "summarizer"];
  if (/ollama|local/i.test(provider)) return ["explorer", "coder_b", "runner", "summarizer"];
  return allRoles;
}

function defaultTrustForProvider(provider: string): AgentTrustLevel {
  if (/mock|fixture|openrouter|anthropic|codex/i.test(provider)) return "high";
  if (/deepseek|mimo|kimi|gemini|ollama/i.test(provider)) return "medium";
  return "medium";
}

function normalizeTrust(value: string, override?: AgentTrustLevel): AgentTrustLevel {
  if (override) return override;
  if (value === "owner" || value === "high") return "high";
  if (value === "low") return "low";
  return "medium";
}

function dedupeProfiles(profiles: AgentRuntimeProfile[]): AgentRuntimeProfile[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.agentId)) return false;
    seen.add(profile.agentId);
    return true;
  });
}
