import type { TomorrowEdgeConfig } from "../../config/schema.js";
import type { AgentRole } from "../../schemas/agentTask.js";

export type CapabilityCostTier = "cheap" | "medium" | "expensive";
export type CapabilityLatencyTier = "fast" | "medium" | "slow";
export type AgentTrustLevel = "low" | "medium" | "high";

export type AgentCapabilityProfile = {
  planning: number;
  architecture: number;
  coding: number;
  review: number;
  judging: number;
  repair: number;
  longContext: number;
  toolUse: number;
  patchGeneration: number;
  testGeneration: number;
  costTier: CapabilityCostTier;
  latencyTier: CapabilityLatencyTier;
  reliabilityScore: number;
  supportsMcp: boolean;
  supportsJson: boolean;
  supportsPatch: boolean;
  supportsShell: boolean;
};

export type AgentRuntimeProfile = {
  agentId: string;
  provider: string;
  model?: string;
  adapterId?: string;
  capabilities: AgentCapabilityProfile;
  allowedRoles: AgentRole[];
  maxParallelTasks?: number;
  trustLevel: AgentTrustLevel;
};

export type AgentCapabilityOverride = Partial<Omit<AgentCapabilityProfile, "costTier" | "latencyTier">> & {
  costTier?: CapabilityCostTier;
  latencyTier?: CapabilityLatencyTier;
  allowedRoles?: AgentRole[];
  trustLevel?: AgentTrustLevel;
  maxParallelTasks?: number;
};

export function clampCapabilityScore(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function mergeCapabilityProfile(base: AgentCapabilityProfile, override: AgentCapabilityOverride = {}): AgentCapabilityProfile {
  return {
    planning: clampCapabilityScore(override.planning, base.planning),
    architecture: clampCapabilityScore(override.architecture, base.architecture),
    coding: clampCapabilityScore(override.coding, base.coding),
    review: clampCapabilityScore(override.review, base.review),
    judging: clampCapabilityScore(override.judging, base.judging),
    repair: clampCapabilityScore(override.repair, base.repair),
    longContext: clampCapabilityScore(override.longContext, base.longContext),
    toolUse: clampCapabilityScore(override.toolUse, base.toolUse),
    patchGeneration: clampCapabilityScore(override.patchGeneration, base.patchGeneration),
    testGeneration: clampCapabilityScore(override.testGeneration, base.testGeneration),
    costTier: override.costTier ?? base.costTier,
    latencyTier: override.latencyTier ?? base.latencyTier,
    reliabilityScore: clampCapabilityScore(override.reliabilityScore, base.reliabilityScore),
    supportsMcp: override.supportsMcp ?? base.supportsMcp,
    supportsJson: override.supportsJson ?? base.supportsJson,
    supportsPatch: override.supportsPatch ?? base.supportsPatch,
    supportsShell: override.supportsShell ?? base.supportsShell
  };
}

export function capabilityProfileFromTags(tags: string[], fallback: AgentCapabilityProfile): AgentCapabilityProfile {
  const normalized = new Set(tags.map((tag) => tag.toLowerCase()));
  return mergeCapabilityProfile(fallback, {
    planning: normalized.has("planning") || normalized.has("core") ? Math.max(fallback.planning, 0.8) : fallback.planning,
    architecture: normalized.has("architecture") || normalized.has("core") ? Math.max(fallback.architecture, 0.8) : fallback.architecture,
    coding: normalized.has("coding") ? Math.max(fallback.coding, 0.8) : fallback.coding,
    review: normalized.has("review") ? Math.max(fallback.review, 0.8) : fallback.review,
    judging: normalized.has("judgment") || normalized.has("judge") ? Math.max(fallback.judging, 0.8) : fallback.judging,
    repair: normalized.has("repair") ? Math.max(fallback.repair, 0.8) : fallback.repair,
    longContext: normalized.has("long_context") ? Math.max(fallback.longContext, 0.75) : fallback.longContext,
    toolUse: normalized.has("tool_use") ? Math.max(fallback.toolUse, 0.8) : fallback.toolUse,
    patchGeneration: normalized.has("patch") || normalized.has("coding") ? Math.max(fallback.patchGeneration, 0.8) : fallback.patchGeneration,
    testGeneration: normalized.has("test") ? Math.max(fallback.testGeneration, 0.75) : fallback.testGeneration,
    supportsMcp: normalized.has("mcp") || fallback.supportsMcp,
    supportsPatch: normalized.has("patch") || fallback.supportsPatch
  });
}

export function configuredCapabilityOverride(config: TomorrowEdgeConfig, agentId: string): AgentCapabilityOverride | undefined {
  return config.agent_capabilities?.[agentId];
}
